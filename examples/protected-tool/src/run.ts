/**
 * Express and Fastify calendar tools, checked against a Grantslip issuer.
 *
 *   GET  with no badge                 → 401 malformed
 *   GET  with calendar:read            → 200
 *   POST with calendar:read            → 403 scope
 *   POST with calendar:write           → 201
 *
 * Default issuer: https://grantslip-issuer.fly.dev
 * Override with GRANTSLIP_ISSUER_URL (or KEYRING_ISSUER_URL).
 * Mint and verify need no admin secret.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { GrantslipClient } from "@grantslip/sdk";
import {
  CALENDAR_AUD,
  CALENDAR_READ,
  CALENDAR_WRITE,
  createExpressApp,
  createFastifyApp,
} from "./servers.js";

const DEFAULT_ISSUER = "https://grantslip-issuer.fly.dev";

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
  const catalog = await fetch(`${url}/v0/catalog/${encodeURIComponent(CALENDAR_AUD)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await catalog.json().catch(() => undefined)) as {
    scopes?: Array<{ scope?: string }>;
    message?: string;
  };
  if (!catalog.ok) {
    throw new Error(`GET /v0/catalog/${CALENDAR_AUD} returned HTTP ${catalog.status} ${body?.message ?? ""}`);
  }
  const offered = new Set((body.scopes ?? []).map((item) => item.scope));
  for (const scope of [CALENDAR_READ, CALENDAR_WRITE]) {
    if (!offered.has(scope)) {
      throw new Error(`${CALENDAR_AUD} does not offer ${scope}. Offered: ${[...offered].join(" ") || "(none)"}`);
    }
  }
}

interface Hit {
  status: number;
  body: Record<string, unknown>;
}

async function hit(url: string, method: "GET" | "POST", token?: string): Promise<Hit> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (method === "POST") headers["content-type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? "{}" : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

function assertCall(step: string, result: Hit, status: number, error?: string): void {
  const ok = error === undefined ? result.body.ok === true : result.body.error === error;
  if (result.status !== status || !ok) {
    const expected = error === undefined ? "ok" : error;
    throw new Error(`${step}: expected HTTP ${status} ${expected}, got ${result.status} ${JSON.stringify(result.body)}`);
  }
}

function listenExpress(app: ReturnType<typeof createExpressApp>): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, "127.0.0.1");
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("express failed to bind"));
        return;
      }
      const info = address as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

async function main(): Promise<void> {
  const issuer = issuerUrl();
  await assertIssuer(issuer);
  const client = new GrantslipClient(issuer);
  const sub = `protected-tool-${crypto.randomUUID()}`;
  const expressServer = await listenExpress(createExpressApp(issuer));
  const fastify = createFastifyApp(issuer);

  try {
    await fastify.listen({ port: 0, host: "127.0.0.1" });
    const address = fastify.server.address();
    if (!address || typeof address === "string") throw new Error("fastify failed to bind");
    const fastifyUrl = `http://127.0.0.1:${address.port}`;

    const read = await client.mint({ sub, aud: CALENDAR_AUD, scope: CALENDAR_READ, ttl: 300 });
    const write = await client.mint({ sub, aud: CALENDAR_AUD, scope: CALENDAR_WRITE, ttl: 300 });

    console.log(`issuer  ${issuer}`);
    console.log(`express ${expressServer.url}/events`);
    console.log(`fastify ${fastifyUrl}/events`);
    console.log(`agent   ${sub}`);
    console.log("");

    for (const [name, base] of [
      ["express", expressServer.url],
      ["fastify", fastifyUrl],
    ] as const) {
      const events = `${base}/events`;
      const missing = await hit(events, "GET");
      assertCall(`${name} missing ticket`, missing, 401, "malformed");
      console.log(`${name}  GET  no ticket        → ${missing.status} ${String(missing.body.error)}`);

      const allowed = await hit(events, "GET", read.token);
      assertCall(`${name} read`, allowed, 200);
      if (allowed.body.sub !== sub || allowed.body.framework !== name) {
        throw new Error(`${name} read: unexpected body ${JSON.stringify(allowed.body)}`);
      }
      console.log(`${name}  GET  calendar:read    → ${allowed.status} sub=${String(allowed.body.sub)}`);

      const wrong = await hit(events, "POST", read.token);
      assertCall(`${name} read on write`, wrong, 403, "scope");
      console.log(`${name}  POST calendar:read    → ${wrong.status} ${String(wrong.body.error)}`);

      const posted = await hit(events, "POST", write.token);
      assertCall(`${name} write`, posted, 201);
      if (posted.body.written !== true) {
        throw new Error(`${name} write: expected written true, got ${JSON.stringify(posted.body)}`);
      }
      console.log(`${name}  POST calendar:write   → ${posted.status} written`);
      console.log("");
    }

    console.log("protected tool passed: express and fastify");
  } finally {
    await Promise.allSettled([expressServer.close(), fastify.close()]);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
