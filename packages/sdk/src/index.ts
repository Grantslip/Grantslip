import type {
  ApiErrorBody,
  GrantRequest,
  GrantResponse,
  GrantStatus,
  Receipt,
  RevokeResponse,
  TopupRequest,
  UsageAccount,
  UsageResponse,
  VerifyRequest,
  VerifyResponse,
} from "@grantslip/middleware";

export class KeyringError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "KeyringError";
  }
}

function adminSecretFromEnv(): string | undefined {
  if (typeof process === "undefined" || typeof process.env === "undefined") return undefined;
  const value = process.env.GRANTSLIP_ADMIN_SECRET?.trim();
  return value ? value : undefined;
}

export class KeyringClient {
  /**
   * `adminSecret`, when passed, is sent as `Authorization: Bearer` on revoke,
   * grant lookup, receipts, usage, and top-up. Mint and verify never send it.
   * When the argument is omitted, those admin calls use `GRANTSLIP_ADMIN_SECRET`
   * from the environment if it is set.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly adminSecret?: string,
  ) {}

  get url(): string {
    return this.baseUrl.replace(/\/$/, "");
  }

  async mint(body: GrantRequest): Promise<GrantResponse> {
    return this.request<GrantResponse>("POST", "/v0/grants", body, false);
  }

  async verify(body: VerifyRequest): Promise<VerifyResponse> {
    return this.request<VerifyResponse>("POST", "/v0/verify", body, false);
  }

  async revoke(jti: string): Promise<RevokeResponse> {
    return this.request<RevokeResponse>("POST", `/v0/grants/${encodeURIComponent(jti)}/revoke`, undefined, true);
  }

  async grant(jti: string): Promise<GrantStatus> {
    return this.request<GrantStatus>("GET", `/v0/grants/${encodeURIComponent(jti)}`, undefined, true);
  }

  async receipt(id: string): Promise<Receipt> {
    return this.request<Receipt>("GET", `/v0/receipts/${encodeURIComponent(id)}`, undefined, true);
  }

  async usage(sub: string): Promise<UsageResponse> {
    return this.request<UsageResponse>("GET", `/v0/usage/${encodeURIComponent(sub)}`, undefined, true);
  }

  async usageAll(): Promise<{
    accounts: UsageAccount[];
    costs: UsageResponse["costs"];
    default_credits: number;
  }> {
    return this.request("GET", "/v0/usage", undefined, true);
  }

  async topup(sub: string, amount: number): Promise<UsageResponse> {
    const body: TopupRequest = { sub, amount };
    return this.request<UsageResponse>("POST", "/v0/topup", body, true);
  }

  async jwks(): Promise<{ keys: unknown[] }> {
    return this.request<{ keys: unknown[] }>("GET", "/.well-known/jwks.json", undefined, false);
  }

  private resolvedAdminSecret(): string | undefined {
    const explicit = this.adminSecret?.trim();
    if (explicit) return explicit;
    return adminSecretFromEnv();
  }

  private async request<T>(method: string, path: string, body?: unknown, useAdmin = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (useAdmin) {
      const secret = this.resolvedAdminSecret();
      if (secret) headers.authorization = `Bearer ${secret}`;
    }
    const res = await this.fetcher(`${this.url}${path}`, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
      const err = data as ApiErrorBody | undefined;
      throw new KeyringError(
        err?.message ?? `HTTP ${res.status} ${method} ${path}`,
        err?.error ?? "http",
        res.status,
        data,
      );
    }
    return data as T;
  }
}

export type {
  GrantRequest,
  GrantResponse,
  GrantStatus,
  Receipt,
  RevokeResponse,
  TopupRequest,
  UsageAccount,
  UsageResponse,
  VerifyRequest,
  VerifyResponse,
};

/** Product name for the same client class. */
export { KeyringClient as GrantslipClient, KeyringError as GrantslipError };
