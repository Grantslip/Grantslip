import type { TicketClaims, VerifyFailureReason, VerifyResponse } from "./types.js";
import { createVerifier, type VerifierOptions } from "./verify.js";

export const TICKET_HEADER = "x-keyring-ticket";

export type VerifyMode = "issuer" | "local";

export interface HeaderMap {
  [name: string]: string | string[] | undefined;
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/** Bearer token, or `X-Keyring-Ticket` (MCP HTTP transports use the same headers). */
export function extractTicket(headers: HeaderMap, alternateHeader = TICKET_HEADER): string | undefined {
  const auth = headerValue(headers, "authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const token = auth.replace(/^bearer\s+/i, "").trim();
    if (token.length > 0) return token;
  }
  const alt = headerValue(headers, alternateHeader)?.trim();
  return alt && alt.length > 0 ? alt : undefined;
}

export function denyStatus(error: VerifyFailureReason): number {
  if (
    error === "malformed" ||
    error === "invalid_signature" ||
    error === "expired" ||
    error === "iss"
  ) {
    return 401;
  }
  return 403;
}

function issuerBase(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export async function verifyViaIssuer(opts: {
  issuerUrl: string;
  token: string;
  aud?: string;
  scope?: string;
  action?: string;
  cost?: number;
  /** Aborts the issuer call. Defaults to 5 seconds. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}): Promise<VerifyResponse> {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(new URL("v0/verify", issuerBase(opts.issuerUrl)), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: opts.token,
        aud: opts.aud,
        scope: opts.scope,
        action: opts.action,
        cost: opts.cost,
      }),
      signal: controller.signal,
    });
    const body = (await res.json()) as VerifyResponse;
    if (!body || typeof body.ok !== "boolean") {
      return { ok: false, error: "unknown", message: "issuer verify failed" };
    }
    return body;
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    return {
      ok: false,
      error: "unknown",
      message: aborted ? "issuer verify timed out" : "issuer verify failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface RequestLike {
  headers: HeaderMap;
  method?: string;
  url?: string;
  keyring?: TicketClaims;
}

export interface ReplyLike {
  status(code: number): { send(body: unknown): void; json?(body: unknown): void };
  sent?: boolean;
}

export interface ConnectResponse {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
  status?(code: number): ConnectResponse;
  json?(body: unknown): void;
}

export type ScopeResolver = string | ((req: RequestLike) => string | undefined);
export type ActionResolver = string | ((req: RequestLike) => string | undefined);
export type CostResolver = number | ((req: RequestLike) => number | undefined);

export interface KeyringHttpOptions {
  issuerUrl: string;
  audience: string;
  /**
   * `issuer` (default): POST /v0/verify — enforces budget, pol, denylist, aud, scope.
   * `local`: JWKS + GET denylist only. Does not enforce budget or pol.
   */
  mode?: VerifyMode;
  requiredScope?: ScopeResolver;
  action?: ActionResolver;
  cost?: CostResolver;
  expectedIss?: string;
  ticketHeader?: string;
  fetch?: typeof fetch;
  now?: VerifierOptions["now"];
}

function resolve<T>(value: T | ((req: RequestLike) => T | undefined) | undefined, req: RequestLike): T | undefined {
  if (typeof value === "function") return (value as (req: RequestLike) => T | undefined)(req);
  return value;
}

export function createKeyringGuard(opts: KeyringHttpOptions) {
  const mode: VerifyMode = opts.mode ?? "issuer";
  const local = createVerifier({
    issuerUrl: opts.issuerUrl,
    expectedIss: opts.expectedIss,
    expectedAud: opts.audience,
    fetch: opts.fetch,
    now: opts.now,
  });

  return async function protect(req: RequestLike): Promise<VerifyResponse> {
    const token = extractTicket(req.headers, opts.ticketHeader);
    if (!token) {
      return { ok: false, error: "malformed", message: "missing ticket (Authorization Bearer or X-Keyring-Ticket)" };
    }
    const scope = resolve(opts.requiredScope, req);
    const action = resolve(opts.action, req);
    const cost = resolve(opts.cost, req);
    if (mode === "local") {
      return local(token, { requiredScope: scope, aud: opts.audience });
    }
    return verifyViaIssuer({
      issuerUrl: opts.issuerUrl,
      token,
      aud: opts.audience,
      scope,
      action,
      cost,
      fetch: opts.fetch,
    });
  };
}

function sendDeny(res: ConnectResponse, status: number, body: unknown): void {
  if (typeof res.status === "function") {
    const chained = res.status(status);
    if (typeof chained.json === "function") {
      chained.json(body);
      return;
    }
  }
  if (typeof res.json === "function") {
    res.statusCode = status;
    res.json(body);
    return;
  }
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Connect/Express middleware. On allow, sets `req.keyring` and calls `next()`.
 */
export function keyring(opts: KeyringHttpOptions) {
  const protect = createKeyringGuard(opts);
  return function keyringMiddleware(
    req: RequestLike,
    res: ConnectResponse,
    next: (err?: unknown) => void,
  ): void {
    protect(req)
      .then((result) => {
        if (!result.ok) {
          sendDeny(res, denyStatus(result.error), {
            ok: false,
            error: result.error,
            message: result.message,
          });
          return;
        }
        req.keyring = result.claims;
        next();
      })
      .catch(next);
  };
}

/** Fastify `preHandler` hook. Sends 401/403 and returns; on allow sets `request.keyring`. */
export function keyringFastify(opts: KeyringHttpOptions) {
  const protect = createKeyringGuard(opts);
  return async function keyringPreHandler(request: RequestLike, reply: ReplyLike): Promise<void> {
    const result = await protect(request);
    if (!result.ok) {
      reply.status(denyStatus(result.error)).send({
        ok: false,
        error: result.error,
        message: result.message,
      });
      return;
    }
    request.keyring = result.claims;
  };
}
