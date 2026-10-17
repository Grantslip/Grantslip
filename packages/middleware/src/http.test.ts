import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createKeyringGuard,
  denyStatus,
  extractTicket,
  keyring,
  TICKET_HEADER,
  verifyViaIssuer,
} from "./http.js";
import type { RequestLike } from "./http.js";

async function testKeys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const other = await generateKeyPair("ES256", { extractable: true });
  const kid = "test-kid";
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  return { privateKey, otherPrivateKey: other.privateKey, publicJwk, kid };
}

async function signedTicket(
  keys: Awaited<ReturnType<typeof testKeys>>,
  opts?: { aud?: string; scope?: string; jti?: string; badKey?: boolean },
) {
  const token = await new SignJWT({ scope: opts?.scope ?? "calendar:read" })
    .setProtectedHeader({ alg: "ES256", kid: keys.kid, typ: "JWT" })
    .setJti(opts?.jti ?? "tkt_test")
    .setIssuer("keyring:test")
    .setSubject("agent-a")
    .setAudience(opts?.aud ?? "tool:calendar")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(opts?.badKey ? keys.otherPrivateKey : keys.privateKey);
  return token;
}

function mockFetch(opts: {
  publicJwk: Record<string, unknown>;
  revoked?: boolean;
  issuerResult?: { ok: boolean; error?: string; message?: string; claims?: unknown };
}) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("jwks")) {
      return new Response(JSON.stringify({ keys: [opts.publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v0/verify") && init?.method === "POST") {
      const body = opts.issuerResult ?? { ok: true, claims: { jti: "tkt_test" } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v0/grants/")) {
      return new Response(JSON.stringify({ revoked: opts.revoked === true, jti: "tkt_test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("extractTicket", () => {
  it("reads Bearer and X-Keyring-Ticket", () => {
    expect(extractTicket({ authorization: "Bearer abc.def.ghi" })).toBe("abc.def.ghi");
    expect(extractTicket({ Authorization: "bearer xyz" })).toBe("xyz");
    expect(extractTicket({ [TICKET_HEADER]: "from-alt" })).toBe("from-alt");
    expect(extractTicket({})).toBeUndefined();
  });
});

describe("denyStatus", () => {
  it("maps auth vs authorization failures", () => {
    expect(denyStatus("malformed")).toBe(401);
    expect(denyStatus("invalid_signature")).toBe(401);
    expect(denyStatus("expired")).toBe(401);
    expect(denyStatus("aud")).toBe(403);
    expect(denyStatus("scope")).toBe(403);
    expect(denyStatus("revoked")).toBe(403);
    expect(denyStatus("budget")).toBe(403);
    expect(denyStatus("pol")).toBe(403);
  });
});

describe("local guard", () => {
  it("allows a good ticket and attaches via connect middleware", async () => {
    const keys = await testKeys();
    const token = await signedTicket(keys);
    const fetchImpl = mockFetch({ publicJwk: keys.publicJwk });
    const protect = createKeyringGuard({
      issuerUrl: "http://issuer.test/",
      audience: "tool:calendar",
      mode: "local",
      requiredScope: "calendar:read",
      expectedIss: "keyring:test",
      fetch: fetchImpl,
    });
    const ok = await protect({ headers: { authorization: `Bearer ${token}` } });
    expect(ok.ok).toBe(true);

    const req: RequestLike = { headers: { authorization: `Bearer ${token}` } };
    let nexted = false;
    let status = 0;
    let body: unknown;
    const mw = keyring({
      issuerUrl: "http://issuer.test/",
      audience: "tool:calendar",
      mode: "local",
      requiredScope: "calendar:read",
      expectedIss: "keyring:test",
      fetch: fetchImpl,
    });
    await new Promise<void>((resolve) => {
      mw(
        req,
        {
          status(code) {
            status = code;
            return this;
          },
          json(value) {
            body = value;
          },
          setHeader() {},
          end() {},
        },
        () => {
          nexted = true;
          resolve();
        },
      );
      setTimeout(resolve, 200);
    });
    expect(nexted).toBe(true);
    expect(req.keyring?.aud).toBe("tool:calendar");
    expect(status).toBe(0);
    expect(body).toBeUndefined();
  });

  it("denies bad signature, wrong aud, missing scope, and revoked", async () => {
    const keys = await testKeys();
    const good = await signedTicket(keys);
    const badSig = await signedTicket(keys, { badKey: true });
    const wrongAud = await signedTicket(keys, { aud: "tool:other" });
    const narrow = await signedTicket(keys, { scope: "calendar:read" });

    const deny = async (token: string, extra?: { revoked?: boolean; scope?: string; aud?: string }) => {
      const protect = createKeyringGuard({
        issuerUrl: "http://issuer.test/",
        audience: extra?.aud ?? "tool:calendar",
        mode: "local",
        requiredScope: extra?.scope ?? "calendar:read",
        expectedIss: "keyring:test",
        fetch: mockFetch({ publicJwk: keys.publicJwk, revoked: extra?.revoked }),
      });
      return protect({ headers: { authorization: `Bearer ${token}` } });
    };

    const sig = await deny(badSig);
    expect(sig.ok).toBe(false);
    if (!sig.ok) expect(sig.error).toBe("invalid_signature");

    const aud = await deny(wrongAud);
    expect(aud.ok).toBe(false);
    if (!aud.ok) expect(aud.error).toBe("aud");

    const scope = await deny(narrow, { scope: "calendar:write" });
    expect(scope.ok).toBe(false);
    if (!scope.ok) expect(scope.error).toBe("scope");

    const revoked = await deny(good, { revoked: true });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.error).toBe("revoked");
  });
});

describe("issuer mode", () => {
  it("forwards to POST /v0/verify", async () => {
    const keys = await testKeys();
    const token = await signedTicket(keys);
    const protect = createKeyringGuard({
      issuerUrl: "http://issuer.test/",
      audience: "tool:calendar",
      mode: "issuer",
      requiredScope: "calendar:read",
      action: "calendar.read",
      cost: 1,
      fetch: mockFetch({
        publicJwk: keys.publicJwk,
        issuerResult: {
          ok: true,
          claims: { jti: "tkt_test", aud: "tool:calendar", scope: "calendar:read" },
        },
      }),
    });
    const ok = await protect({ headers: { [TICKET_HEADER]: token } });
    expect(ok.ok).toBe(true);
  });

  it("surfaces issuer deny codes", async () => {
    const keys = await testKeys();
    const token = await signedTicket(keys);
    const protect = createKeyringGuard({
      issuerUrl: "http://issuer.test/",
      audience: "tool:calendar",
      mode: "issuer",
      fetch: mockFetch({
        publicJwk: keys.publicJwk,
        issuerResult: { ok: false, error: "budget", message: "budget exceeded" },
      }),
    });
    const denied = await protect({ headers: { authorization: `Bearer ${token}` } });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("budget");
  });
});

describe("verifyViaIssuer", () => {
  it("times out a hung issuer call", async () => {
    const result = await verifyViaIssuer({
      issuerUrl: "http://issuer.test/",
      token: "x.y.z",
      timeoutMs: 30,
      fetch: ((_url: string | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unknown");
      expect(result.message).toBe("issuer verify timed out");
    }
  });

  it("returns unknown on transport failure", async () => {
    const result = await verifyViaIssuer({
      issuerUrl: "http://issuer.test/",
      token: "x.y.z",
      fetch: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unknown");
  });
});
