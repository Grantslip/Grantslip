# `@grantslip/sdk`

TypeScript client for a Grantslip issuer. Mint and verify send no `Authorization` header. Revoke, grant lookup, receipts, usage, and top-up send `Authorization: Bearer <GRANTSLIP_ADMIN_SECRET>` when that value is passed to the constructor or set in the environment.

```ts
import { GrantslipClient } from "@grantslip/sdk";

const grantslip = new GrantslipClient("https://grantslip-issuer.fly.dev");
const grant = await grantslip.mint({
  sub: "agent-a",
  aud: "tool:calendar",
  scope: "calendar:read",
});
```

`KeyringClient` is the same class. `GrantslipError` / `KeyringError` carries `code` and `status`. A scope the issuer has not listed throws `code` `scope_not_offered` and status 400.

`GET /v0/catalog` on the issuer returns the scopes each tool lists. That route does not use the admin secret.
