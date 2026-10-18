# `@grantslip/middleware`

Drop-in check for a tool server. The badge is `Authorization: Bearer <jwt>` or the `X-Keyring-Ticket` header.

Issuer mode (the default) posts the badge to `{issuerUrl}/v0/verify`. That enforces audience, scope, expiry, revoke, budget, and policy.

```ts
import { grantslip } from "@grantslip/middleware";

app.use("/events", grantslip({
  issuerUrl: process.env.GRANTSLIP_ISSUER_URL ?? "https://grantslip-issuer.fly.dev",
  audience: "tool:calendar",
  requiredScope: (req) => (req.method === "POST" ? "calendar:write" : "calendar:read"),
  cost: 1,
}));
```

```ts
import { grantslipFastify } from "@grantslip/middleware";

fastify.addHook("preHandler", grantslipFastify({
  issuerUrl: process.env.GRANTSLIP_ISSUER_URL ?? "https://grantslip-issuer.fly.dev",
  audience: "tool:calendar",
  requiredScope: "calendar:read",
}));
```

`keyring` and `keyringFastify` are the same functions. On allow, the claims are on `req.keyring`. On deny, the response is HTTP 401 (`malformed`, `invalid_signature`, `expired`, `iss`) or HTTP 403 (everything else) with `{ ok: false, error, message }`.

`mode: "local"` checks the JWKS signature and `GET /v0/grants/{jti}` for revoke. It does not enforce budget or policy.
