/**
 * MCP-style tools/call gate.
 *
 * The gate is src/guard.ts (copy that file into a gateway). It stays off
 * unless enabled is true. On, a missing or rejected badge never reaches the tool.
 *
 * The hosted catalog lists tool:local / local:read, so this run mints that
 * pair and passes audience and scope into the guard. Omit those two fields
 * to use tool:<serverName>/<toolName> and <toolName>:call.
 *
 * Default issuer: https://grantslip-issuer.fly.dev
 * GRANTSLIP_ISSUER_URL or KEYRING_ISSUER_URL overrides it.
 * Set GRANTSLIP_ADMIN_SECRET to also revoke the badge and show the next call denied.
 * Mint and verify work without that secret.
 */
import { GrantslipClient, KeyringError } from "@grantslip/sdk";
import {
  assertGrantslipBeforeToolCall,
  GRANTSLIP_TICKET_HEADER,
  GrantslipDeniedError,
} from "./guard.js";

const DEFAULT_ISSUER = "https://grantslip-issuer.fly.dev";
const SERVER_NAME = "local";
const TOOL_NAME = "read";
const AUDIENCE = "tool:local";
const SCOPE = "local:read";

function issuerUrl(): string {
  const raw = (process.env.GRANTSLIP_ISSUER_URL ?? process.env.KEYRING_ISSUER_URL ?? DEFAULT_ISSUER).trim();
  if (raw.length === 0) throw new Error("GRANTSLIP_ISSUER_URL is empty");
  return raw.replace(/\/$/, "");
}

async function assertIssuer(url: string): Promise<void> {
  const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(20_000) });
  const healthBody = (await health.json().catch(() => undefined)) as { ok?: unknown } | undefined;
  if (!health.ok || healthBody?.ok !== true) {
    throw new Error(`GET ${url}/health returned HTTP ${health.status}`);
  }
  const catalog = await fetch(`${url}/v0/catalog/${encodeURIComponent(AUDIENCE)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await catalog.json().catch(() => undefined)) as {
    scopes?: Array<{ scope?: string }>;
    message?: string;
  };
  if (!catalog.ok) {
    throw new Error(`GET /v0/catalog/${AUDIENCE} returned HTTP ${catalog.status} ${body?.message ?? ""}`);
  }
  const offered = new Set((body.scopes ?? []).map((item) => item.scope));
  if (!offered.has(SCOPE)) {
    throw new Error(`${AUDIENCE} does not offer ${SCOPE}. Offered: ${[...offered].join(" ") || "(none)"}`);
  }
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function upstream(): ToolResult {
  return { content: [{ type: "text", text: "pong:local.read" }] };
}

interface GatewayOutcome {
  forwarded: boolean;
  result: ToolResult;
  receipt_id?: string;
  reason?: string;
}

async function gatewayToolsCall(
  url: string,
  headers: Record<string, string> | undefined,
  enabled: boolean,
  fetcher: typeof fetch = fetch,
): Promise<GatewayOutcome> {
  try {
    const pass = await assertGrantslipBeforeToolCall({
      enabled,
      issuerUrl: url,
      headers,
      serverName: SERVER_NAME,
      toolName: TOOL_NAME,
      audience: AUDIENCE,
      scope: SCOPE,
      cost: 1,
      fetch: fetcher,
    });
    return { forwarded: true, result: upstream(), receipt_id: pass.receipt_id };
  } catch (err) {
    if (err instanceof GrantslipDeniedError) {
      return {
        forwarded: false,
        reason: err.reason,
        result: {
          content: [{ type: "text", text: `Error: ${err.name} | ${err.message}` }],
          isError: true,
        },
      };
    }
    throw err;
  }
}

function textOf(result: ToolResult): string {
  return result.content.map((part) => part.text).join("");
}

async function main(): Promise<void> {
  const issuer = issuerUrl();
  await assertIssuer(issuer);
  const client = new GrantslipClient(issuer);
  const sub = `mcp-server-${crypto.randomUUID()}`;
  const admin = Boolean(process.env.GRANTSLIP_ADMIN_SECRET?.trim());
  let jti: string | undefined;

  console.log(`issuer  ${issuer}`);
  console.log(`tool    ${SERVER_NAME}/${TOOL_NAME}  aud=${AUDIENCE}  scope=${SCOPE}`);
  console.log(`agent   ${sub}`);
  console.log("");

  try {
    const off = await gatewayToolsCall(issuer, undefined, false, async () => {
      throw new Error("issuer contacted while guard off");
    });
    if (!off.forwarded || textOf(off.result) !== "pong:local.read") {
      throw new Error(`guard-off: expected a forwarded pong, got ${JSON.stringify(off)}`);
    }
    console.log("guard-off");
    console.log("  enabled=false  decision=forwarded  upstream=called  issuer=not-contacted");
    console.log("");

    const denied = await gatewayToolsCall(issuer, undefined, true);
    if (denied.forwarded || denied.reason !== "malformed" || denied.result.isError !== true) {
      throw new Error(`denied: expected malformed and no forward, got ${JSON.stringify(denied)}`);
    }
    console.log("denied");
    console.log(`  tools/call ${SERVER_NAME}/${TOOL_NAME}  badge=none  decision=denied  error=${denied.reason}`);
    console.log(`  ${textOf(denied.result)}`);
    console.log("");

    const grant = await client.mint({ sub, aud: AUDIENCE, scope: SCOPE, ttl: 300 });
    jti = grant.jti;
    const allowed = await gatewayToolsCall(issuer, { [GRANTSLIP_TICKET_HEADER]: grant.token }, true);
    if (!allowed.forwarded || !allowed.receipt_id || textOf(allowed.result) !== "pong:local.read") {
      throw new Error(`allowed: expected forward, pong, and receipt_id, got ${JSON.stringify(allowed)}`);
    }
    console.log("allowed");
    console.log(`  mint jti=${grant.jti} sub=${sub} aud=${AUDIENCE} scope=${SCOPE}`);
    console.log(`  tools/call ${SERVER_NAME}/${TOOL_NAME}  badge=present  decision=allowed  result=${textOf(allowed.result)}`);
    console.log(`  receipt_id ${allowed.receipt_id}`);
    console.log("");

    if (admin && jti) {
      const revocation = await client.revoke(jti);
      jti = undefined;
      const again = await gatewayToolsCall(issuer, { [GRANTSLIP_TICKET_HEADER]: grant.token }, true);
      if (again.forwarded || again.reason !== "revoked") {
        throw new Error(`revoked-and-denied: expected revoked, got ${JSON.stringify(again)}`);
      }
      console.log("revoked-and-denied");
      console.log(`  revoke jti=${revocation.jti} count=${revocation.count}`);
      console.log(`  tools/call ${SERVER_NAME}/${TOOL_NAME}  badge=present  decision=denied  error=${again.reason}`);
      console.log("");
      console.log("mcp example passed: denied, allowed, revoked-and-denied");
      return;
    }

    console.log("revoke skipped");
    console.log("  set GRANTSLIP_ADMIN_SECRET=your-admin-secret to revoke this badge and re-check");
    console.log("");
    console.log("mcp example passed: denied, allowed");
  } finally {
    if (jti && admin) {
      await client.revoke(jti).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`warn  revoke cleanup failed: ${message}`);
      });
    }
  }
}

main().catch((err: unknown) => {
  if (err instanceof KeyringError) {
    console.error(`FAIL  ${err.code}`);
    console.error(`      ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
