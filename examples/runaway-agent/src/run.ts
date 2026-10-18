/**
 * An agent that keeps calling a tool. The badge budget stops the loop.
 *
 * Mints tool:notion / notion:read with budget 2. Each verify costs 1.
 * The first two calls are allowed. The third is denied with error "budget".
 *
 * Default issuer: https://grantslip-issuer.fly.dev
 * Override with GRANTSLIP_ISSUER_URL (or KEYRING_ISSUER_URL).
 * Mint and verify need no admin secret.
 */
import { GrantslipClient, KeyringError } from "@grantslip/sdk";

const DEFAULT_ISSUER = "https://grantslip-issuer.fly.dev";
const AUD = "tool:notion";
const SCOPE = "notion:read";
const BUDGET = 2;

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
  const catalog = await fetch(`${url}/v0/catalog/${encodeURIComponent(AUD)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await catalog.json().catch(() => undefined)) as {
    scopes?: Array<{ scope?: string }>;
    message?: string;
  };
  if (!catalog.ok) {
    throw new Error(`GET /v0/catalog/${AUD} returned HTTP ${catalog.status} ${body?.message ?? ""}`);
  }
  const offered = new Set((body.scopes ?? []).map((item) => item.scope));
  if (!offered.has(SCOPE)) {
    throw new Error(`${AUD} does not offer ${SCOPE}. Offered: ${[...offered].join(" ") || "(none)"}`);
  }
}

async function main(): Promise<void> {
  const issuer = issuerUrl();
  await assertIssuer(issuer);
  const client = new GrantslipClient(issuer);
  const sub = `runaway-${crypto.randomUUID()}`;
  const grant = await client.mint({
    sub,
    aud: AUD,
    scope: SCOPE,
    budget: BUDGET,
    ttl: 300,
  });

  console.log(`issuer  ${issuer}`);
  console.log(`agent   ${sub}`);
  console.log(`badge   ${grant.jti}  aud=${AUD}  scope=${SCOPE}  budget=${BUDGET}`);
  console.log("");

  for (let n = 1; n <= BUDGET + 1; n++) {
    const result = await client.verify({
      token: grant.token,
      aud: AUD,
      scope: SCOPE,
      action: "notion.read",
      cost: 1,
    });
    if (n <= BUDGET) {
      if (!result.ok) {
        throw new Error(`call ${n}: expected allow, got ${JSON.stringify(result)}`);
      }
      console.log(`call ${n}  allow  receipt=${result.receipt_id ?? ""}`);
      continue;
    }
    if (result.ok || result.error !== "budget") {
      throw new Error(`call ${n}: expected budget deny, got ${JSON.stringify(result)}`);
    }
    console.log(`call ${n}  deny   error=${result.error}  ${result.message}`);
  }

  console.log("");
  console.log("runaway agent stopped: budget");
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
