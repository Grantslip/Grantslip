export type {
  ApiErrorBody,
  Decision,
  GrantRequest,
  GrantResponse,
  GrantStatus,
  MeterOp,
  Receipt,
  RevokeResponse,
  TicketClaims,
  TopupRequest,
  UsageAccount,
  UsageResponse,
  VerifyFailure,
  VerifyFailureReason,
  VerifyRequest,
  VerifyResponse,
  VerifySuccess,
} from "./types.js";

export { DEFAULT_CREDIT_BALANCE, METER_COSTS } from "./types.js";

export {
  formatScope,
  hasAllCapabilities,
  isScopeSubset,
  missingCapabilities,
  parseScope,
} from "./scope.js";

export { createVerifier, type VerifierOptions, type VerifyTicketOptions } from "./verify.js";

export {
  TICKET_HEADER,
  createKeyringGuard,
  denyStatus,
  extractTicket,
  keyring,
  keyring as grantslip,
  keyringFastify,
  keyringFastify as grantslipFastify,
  verifyViaIssuer,
  type ConnectResponse,
  type KeyringHttpOptions,
  type ReplyLike,
  type RequestLike,
  type VerifyMode,
} from "./http.js";
