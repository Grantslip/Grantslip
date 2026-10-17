import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import { hasAllCapabilities, missingCapabilities } from "./scope.js";
import type {
  TicketClaims,
  VerifyFailure,
  VerifyFailureReason,
  VerifyResponse,
} from "./types.js";

export interface VerifierOptions {
  /** Issuer base URL, e.g. http://127.0.0.1:47821 */
  issuerUrl: string;
  expectedIss?: string;
  expectedAud?: string;
  /**
   * Override denylist check. Default: GET /v0/grants/{jti} and read `revoked`.
   * Return true if the ticket must be rejected as revoked.
   */
  isRevoked?: (jti: string) => Promise<boolean>;
  /** Clock override (unix seconds). Used in tests. */
  now?: () => number;
  /** JWKS path relative to issuerUrl. */
  jwksPath?: string;
  fetch?: typeof fetch;
}

export interface VerifyTicketOptions {
  requiredScope?: string;
  aud?: string;
}

function fail(error: VerifyFailureReason, message: string, claims?: TicketClaims): VerifyFailure {
  return claims ? { ok: false, error, message, claims } : { ok: false, error, message };
}

function asClaims(payload: JWTPayload): TicketClaims | undefined {
  if (
    typeof payload.jti !== "string" ||
    typeof payload.iss !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.scope !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return undefined;
  }
  const aud = payload.aud;
  if (typeof aud !== "string") return undefined;
  const claims: TicketClaims = {
    jti: payload.jti,
    iss: payload.iss,
    sub: payload.sub,
    aud,
    scope: payload.scope,
    iat: payload.iat,
    exp: payload.exp,
  };
  if (typeof payload.budget === "number") claims.budget = payload.budget;
  if (typeof payload.parent === "string") claims.parent = payload.parent;
  if (payload.pol !== undefined) claims.pol = payload.pol;
  return claims;
}

function issuerBase(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Tool-side verifier: JWKS signature + exp + optional aud/scope + issuer denylist.
 * Does not emit receipts — call POST /v0/verify on the issuer when you need one.
 */
export function createVerifier(opts: VerifierOptions) {
  const base = issuerBase(opts.issuerUrl);
  const jwksUrl = new URL(opts.jwksPath ?? ".well-known/jwks.json", base);
  const doFetch = opts.fetch ?? fetch;

  let cached: ReturnType<typeof createLocalJWKSet> | undefined;
  let cachedAt = 0;
  const cacheMs = 60_000;

  async function jwks() {
    const nowMs = Date.now();
    if (cached && nowMs - cachedAt < cacheMs) return cached;
    const res = await doFetch(jwksUrl);
    if (!res.ok) {
      throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as JSONWebKeySet;
    cached = createLocalJWKSet(body);
    cachedAt = nowMs;
    return cached;
  }

  const checkRevoked =
    opts.isRevoked ??
    (async (jti: string) => {
      const res = await doFetch(new URL(`v0/grants/${encodeURIComponent(jti)}`, base));
      if (res.status === 404) return true;
      if (!res.ok) {
        throw new Error(`denylist check failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as { revoked?: boolean };
      return body.revoked === true;
    });

  return async function verifyTicket(
    token: string,
    extra: VerifyTicketOptions = {},
  ): Promise<VerifyResponse> {
    if (!token || typeof token !== "string" || token.split(".").length !== 3) {
      return fail("malformed", "token is not a JWT");
    }

    const currentDate = opts.now ? new Date(opts.now() * 1000) : undefined;
    const expectedAud = extra.aud ?? opts.expectedAud;

    let payload: JWTPayload;
    try {
      const keyset = await jwks();
      const verified = await jwtVerify(token, keyset, {
        issuer: opts.expectedIss,
        audience: expectedAud,
        currentDate,
      });
      payload = verified.payload;
    } catch (err) {
      if (err instanceof errors.JWTExpired) {
        const claims = asClaims((err.payload ?? {}) as JWTPayload);
        return fail("expired", "ticket expired", claims);
      }
      if (err instanceof errors.JWTClaimValidationFailed) {
        if (err.claim === "aud") {
          return fail("aud", "audience mismatch");
        }
        if (err.claim === "iss") {
          return fail("iss", "issuer mismatch");
        }
        if (err.claim === "exp") {
          return fail("expired", "ticket expired");
        }
      }
      if (err instanceof Error && err.message.startsWith("JWKS fetch failed")) {
        return fail("unknown", err.message);
      }
      return fail("invalid_signature", "signature or JWT validation failed");
    }

    const claims = asClaims(payload);
    if (!claims) {
      return fail("malformed", "ticket is missing required claims");
    }

    if (expectedAud && claims.aud !== expectedAud) {
      return fail("aud", `audience mismatch: expected ${expectedAud}`, claims);
    }

    const required = extra.requiredScope;
    if (required && !hasAllCapabilities(claims.scope, required)) {
      const missing = missingCapabilities(claims.scope, required);
      return fail("scope", `missing capabilities: ${missing.join(" ")}`, claims);
    }

    try {
      if (await checkRevoked(claims.jti)) {
        return fail("revoked", "ticket has been revoked", claims);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "denylist check failed";
      return fail("unknown", message, claims);
    }

    return { ok: true, claims };
  };
}
