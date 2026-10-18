import { afterEach, describe, expect, it } from "vitest";
import { KeyringClient } from "./index.js";

const seen: Array<{ url: string; headers: Record<string, string> | undefined }> = [];

function fetcher(): typeof fetch {
  return async (input, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    seen.push({ url: String(input), headers });
    return new Response(JSON.stringify({ ok: true, jti: "tkt_x", token: "a.b.c", revoked: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const previous = process.env.GRANTSLIP_ADMIN_SECRET;

afterEach(() => {
  seen.length = 0;
  if (previous === undefined) delete process.env.GRANTSLIP_ADMIN_SECRET;
  else process.env.GRANTSLIP_ADMIN_SECRET = previous;
});

describe("KeyringClient admin header", () => {
  it("mints and verifies with no auth header even when a secret is set", async () => {
    process.env.GRANTSLIP_ADMIN_SECRET = "admin-secret-value";
    const client = new KeyringClient("http://issuer.test", fetcher(), "constructor-secret");
    await client.mint({ sub: "agent-a", aud: "tool:local", scope: "local:read" });
    await client.verify({ token: "a.b.c" });
    await client.jwks();
    expect(seen[0]?.headers).toEqual({ "content-type": "application/json" });
    expect(seen[0]?.headers).not.toHaveProperty("authorization");
    expect(seen[1]?.headers).toEqual({ "content-type": "application/json" });
    expect(seen[2]?.headers).toBeUndefined();
  });

  it("sends the bearer secret on revoke, status, receipts, usage, and top-up", async () => {
    delete process.env.GRANTSLIP_ADMIN_SECRET;
    const client = new KeyringClient("http://issuer.test", fetcher());
    await client.revoke("tkt_x");
    expect(seen[0]?.headers).toBeUndefined();

    process.env.GRANTSLIP_ADMIN_SECRET = "from-env";
    const authed = new KeyringClient("http://issuer.test", fetcher());
    await authed.revoke("tkt_x");
    await authed.grant("tkt_x");
    await authed.receipt("rct_x");
    await authed.usage("agent-a");
    await authed.usageAll();
    await authed.topup("agent-a", 5);
    for (const call of seen.slice(1)) {
      expect(call.headers?.authorization).toBe("Bearer from-env");
    }

    seen.length = 0;
    const explicit = new KeyringClient("http://issuer.test", fetcher(), "from-constructor");
    await explicit.revoke("tkt_x");
    expect(seen[0]?.headers?.authorization).toBe("Bearer from-constructor");
  });
});
