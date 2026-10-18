/** Ticket JWT claims. `scope` is a space-delimited capability string. */
export interface TicketClaims {
  jti: string;
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  iat: number;
  exp: number;
  budget?: number;
  parent?: string;
  pol?: unknown;
}

export type Decision = "allow" | "deny";

/** Receipt v0 — append-only grant/use event. */
export interface Receipt {
  receipt_id: string;
  jti: string;
  sub: string;
  aud: string;
  action: string;
  scope_used: string;
  cost: number;
  ts: string;
  decision: Decision;
}

export interface GrantRequest {
  sub: string;
  aud: string;
  scope: string;
  /** Lifetime in seconds. Default 600 (10 minutes). */
  ttl?: number;
  budget?: number;
  /** Parent ticket jti. Child scope must be a subset of the parent. */
  parent?: string;
  pol?: unknown;
}

export interface GrantResponse {
  token: string;
  jti: string;
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  iat: number;
  exp: number;
  parent?: string;
  budget?: number;
  receipt_id: string;
}

export interface VerifyRequest {
  token: string;
  /** If set, ticket `aud` must match exactly. */
  aud?: string;
  /** If set, every capability in this space-delimited string must be in the ticket. */
  scope?: string;
  /** If set, a receipt is appended (allow or deny). */
  action?: string;
  cost?: number;
}

export type VerifyFailureReason =
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

export interface VerifySuccess {
  ok: true;
  claims: TicketClaims;
  receipt_id?: string;
}

export interface VerifyFailure {
  ok: false;
  error: VerifyFailureReason;
  message: string;
  claims?: TicketClaims;
  receipt_id?: string;
}

export type VerifyResponse = VerifySuccess | VerifyFailure;

export interface RevokeResponse {
  jti: string;
  revoked: string[];
  count: number;
}

export interface GrantStatus {
  jti: string;
  sub: string;
  aud: string;
  scope: string;
  iat: number;
  exp: number;
  parent?: string;
  revoked: boolean;
  budget?: number;
  spent: number;
}

export interface ApiErrorBody {
  ok: false;
  error: string;
  message: string;
}

export type MeterOp = "mint" | "verify" | "revoke" | "receipt";

/** Credit price per successful op. A cost of 0 never refuses, including at 0 credits. */
export const METER_COSTS: Record<MeterOp, number> = {
  mint: 0,
  verify: 0,
  revoke: 1,
  receipt: 1,
};

export interface UsageAccount {
  sub: string;
  credits: number;
  ops: Record<MeterOp, number>;
  /** Sum of successful verify `cost` values (tool units, not credits). */
  units: number;
}

export interface UsageResponse extends UsageAccount {
  costs: Record<MeterOp, number>;
}

export interface TopupRequest {
  sub: string;
  amount: number;
}

export const DEFAULT_CREDIT_BALANCE = 100;
