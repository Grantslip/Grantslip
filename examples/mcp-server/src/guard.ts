/**
 * Check a Grantslip badge before an MCP gateway forwards tools/call.
 *
 * Plain HTTP to the issuer (POST /v0/verify). No dependency on this monorepo,
 * so the file can be copied into MCPHub as src/services/grantslipGuard.ts.
 *
 * Off unless `enabled` is true. MCPHub's own Authorization bearer key is left
 * alone; the badge is the `X-Keyring-Ticket` header on the tools/call request.
 *
 * `audience` and `scope` default to `tool:<server>/<tool>` and `<tool>:call`.
 * Pass them when the issuer catalog lists a different pair (the hosted issuer
 * lists tool:local / local:read, tool:calendar, and tool:notion).
 */

export const GRANTSLIP_TICKET_HEADER = "x-keyring-ticket";

export type GrantslipDenyReason =
  | "malformed"
  | "invalid_signature"
  | "expired"
  | "revoked"
  | "aud"
  | "scope"
  | "iss"
  | "budget"
  | "pol"
  | "credits"
  | "unknown";

export class GrantslipDeniedError extends Error {
  readonly reason: GrantslipDenyReason;

  constructor(reason: GrantslipDenyReason, message: string) {
    super(message);
    this.name = "GrantslipDeniedError";
    this.reason = reason;
  }
}

export interface HeaderMap {
  [name: string]: string | string[] | undefined;
}

export interface GrantslipCheckInput {
  /** When false or omitted, the check returns immediately and contacts nothing. */
  enabled?: boolean;
  issuerUrl: string;
  headers?: HeaderMap | null;
  serverName: string;
  toolName: string;
  /** Abstract cost units recorded on the verify receipt. Issuer default is 0. */
  cost?: number;
  /**
   * Ticket audience. Default is `tool:<serverName>/<toolName>`.
   * The hosted issuer lists `tool:calendar`, `tool:notion`, and `tool:local`.
   * Pass one of those when minting against that host.
   */
  audience?: string;
  /** Required scope. Default is `<toolName>:call`. */
  scope?: string;
  headerName?: string;
  fetch?: typeof fetch;
}

export interface GrantslipPass {
  skipped: boolean;
  jti?: string;
  receipt_id?: string;
}

interface VerifyBody {
  ok: boolean;
  error?: string;
  message?: string;
  claims?: { jti?: string };
  receipt_id?: string;
}

/** Audience minted for one upstream tool. The ticket `aud` must match exactly. */
export function grantslipAudience(serverName: string, toolName: string): string {
  return `tool:${serverName}/${toolName}`;
}

/** Capability the badge must include for a tools/call of this tool. */
export function grantslipScope(toolName: string): string {
  return `${toolName}:call`;
}

/** Action string stored on the verify receipt. */
export function grantslipAction(serverName: string, toolName: string): string {
  return `${serverName}.${toolName}`;
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function issuerBase(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function isVerifyBody(value: unknown): value is VerifyBody {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { ok?: unknown }).ok === "boolean";
}

function asReason(error: string | undefined): GrantslipDenyReason {
  switch (error) {
    case "malformed":
    case "invalid_signature":
    case "expired":
    case "revoked":
    case "aud":
    case "scope":
    case "iss":
    case "budget":
    case "pol":
    case "credits":
    case "unknown":
      return error;
    default:
      return "unknown";
  }
}

async function postVerify(
  input: GrantslipCheckInput,
  token: string,
): Promise<VerifyBody> {
  const doFetch = input.fetch ?? fetch;
  const audience = input.audience ?? grantslipAudience(input.serverName, input.toolName);
  const scope = input.scope ?? grantslipScope(input.toolName);
  const action = grantslipAction(input.serverName, input.toolName);
  let res: Response;
  try {
    res = await doFetch(new URL("v0/verify", issuerBase(input.issuerUrl)), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        aud: audience,
        scope,
        action,
        cost: input.cost,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "issuer verify failed";
    return { ok: false, error: "unknown", message };
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!isVerifyBody(body)) {
    return {
      ok: false,
      error: "unknown",
      message: `issuer verify: unexpected body (HTTP ${res.status})`,
    };
  }
  return body;
}

/**
 * Returns when the call may proceed. Throws {@link GrantslipDeniedError} when
 * the badge is missing, invalid, out of scope, expired, or revoked.
 * A skipped check (enabled is not true) does not call the issuer.
 */
export async function assertGrantslipBeforeToolCall(input: GrantslipCheckInput): Promise<GrantslipPass> {
  if (input.enabled !== true) {
    return { skipped: true };
  }
  if (input.issuerUrl.trim().length === 0) {
    throw new GrantslipDeniedError("unknown", "GRANTSLIP_ISSUER_URL is not set");
  }
  const headers = input.headers ?? {};
  const token = headerValue(headers, input.headerName ?? GRANTSLIP_TICKET_HEADER);
  if (!token) {
    throw new GrantslipDeniedError("malformed", "missing ticket (X-Keyring-Ticket)");
  }
  const body = await postVerify(input, token);
  if (!body.ok) {
    throw new GrantslipDeniedError(
      asReason(body.error),
      body.message ?? "grantslip verify denied",
    );
  }
  const jti = body.claims?.jti;
  if (!jti) {
    throw new GrantslipDeniedError("malformed", "verify response missing jti");
  }
  return { skipped: false, jti, receipt_id: body.receipt_id };
}
