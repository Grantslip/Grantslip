# Grantslip

Short-lived visitor badges for AI agents — one tool, one scope, a few minutes. The tool checks a badge on each call. The agent never holds a standing API key.

## The loop

1. **Mint** — the agent asks for a badge scoped to one tool and a short lifetime. Each tool lists the permissions it offers. Grantslip turns down a badge for a permission that is not on that list. Anyone can look the list up with `GET /v0/catalog` on the issuer.
2. **Verify** — the tool host checks the badge before it runs the tool.
3. **Revoke** — pull the badge when something looks wrong.
4. **Receipt** — every allow or deny can be logged.

## Why it exists

Agents calling tools with permanent keys is a known failure mode — prompt injection, leaked context, runaway loops. Grantslip gives you containment and an audit trail.

I spent my career as a train engineer, where a mistake can cost lives. You learn to give access only when it's needed, take it back when the job's done, and keep a record of all of it. I built Grantslip with AI coding tools to bring that same discipline to AI agents: short-lived badges, only the tools they need, and a log of every use.

## This repository

This is the TypeScript SDK and the verify middleware, plus examples that run against the hosted issuer. The issuer that signs badges is a separate service.

| | |
| --- | --- |
| Landing | https://grantslip.com/ |
| Issuer API | https://grantslip-issuer.fly.dev |

Mint and verify need no API key. Revoke, receipts, usage, and top-up use `GRANTSLIP_ADMIN_SECRET`.

## Quick start

Node.js 20 or newer. From a fresh clone:

```bash
git clone https://github.com/grantslip/grantslip.git
cd grantslip
corepack enable
pnpm install
pnpm quickstart
```

`pnpm quickstart` builds `@grantslip/sdk` and `@grantslip/middleware`, then runs three examples against `https://grantslip-issuer.fly.dev`:

1. Express and Fastify calendar tools protected by the verify middleware.
2. An MCP-style `tools/call` gate.
3. A retry loop that stops when the badge budget is spent.

Success looks like this:

```
protected tool passed: express and fastify
mcp example passed: denied, allowed
runaway agent stopped: budget
```

Exit code 0 means all three passed. A failed step exits non-zero and prints the reason.

Run one example:

```bash
pnpm build
pnpm example:protected
pnpm example:mcp
pnpm example:runaway
```

Unit tests use no network:

```bash
pnpm test
```

## Issuer URL

```bash
GRANTSLIP_ISSUER_URL=https://grantslip-issuer.fly.dev pnpm quickstart
```

`KEYRING_ISSUER_URL` is read when `GRANTSLIP_ISSUER_URL` is unset. The default is the hosted issuer above.

`GET /health` returns `{ "ok": true }`. `GET /v0/catalog` returns the scopes the issuer will mint. On the hosted issuer those are:

| `aud` | scope |
| --- | --- |
| `tool:calendar` | `calendar:read`, `calendar:write` |
| `tool:notion` | `notion:read`, `notion:write` |
| `tool:local` | `local:read` |

A mint for anything else is HTTP 400 `{ "error": "scope_not_offered" }`. The examples check the catalog first and stop with that list if a scope is missing.

## Admin secret

Mint (`POST /v0/grants`) and verify (`POST /v0/verify`) send no `Authorization` header. The quick start uses only those calls.

These calls send `Authorization: Bearer $GRANTSLIP_ADMIN_SECRET` when the variable is set, or when you pass the same string as the third argument to `GrantslipClient`:

- revoke
- full grant lookup (`GET /v0/grants/{jti}` without the secret returns only `{ jti, revoked }`)
- receipts
- usage
- top-up

```bash
GRANTSLIP_ADMIN_SECRET=your-admin-secret pnpm example:mcp
```

Replace `your-admin-secret` with the secret from your Grantslip account. With it set, the MCP example revokes the badge and expects the next `tools/call` to be denied. With it unset, that step is skipped and the example still passes.

## SDK

```ts
import { GrantslipClient } from "@grantslip/sdk";

const grantslip = new GrantslipClient(
  process.env.GRANTSLIP_ISSUER_URL ?? "https://grantslip-issuer.fly.dev",
);

const grant = await grantslip.mint({
  sub: "agent-a",
  aud: "tool:calendar",
  scope: "calendar:read",
  ttl: 600,
});

const verified = await grantslip.verify({
  token: grant.token,
  aud: "tool:calendar",
  scope: "calendar:read",
  action: "calendar.read",
  cost: 1,
});
```

`KeyringClient` is the same class. A refused mint throws `GrantslipError` (`code`, `status`). Verify returns `{ ok: true, claims }` or `{ ok: false, error, message }`. Check `ok`. A denied verify is still a successful HTTP response.

## Verify middleware

Issuer mode (the default) posts the badge to `{issuerUrl}/v0/verify`, so audience, scope, expiry, revoke, budget, and policy are enforced by the issuer.

The badge is `Authorization: Bearer <jwt>` or `X-Keyring-Ticket`.

Express or Connect:

```ts
import { grantslip } from "@grantslip/middleware";

app.use("/events", grantslip({
  issuerUrl: process.env.GRANTSLIP_ISSUER_URL ?? "https://grantslip-issuer.fly.dev",
  audience: "tool:calendar",
  requiredScope: (req) => (req.method === "POST" ? "calendar:write" : "calendar:read"),
  action: (req) => (req.method === "POST" ? "calendar.write" : "calendar.read"),
  cost: 1,
}));
```

On allow, `req.keyring` is the ticket claims. `grantslip` and `keyring` are the same function.

Fastify:

```ts
import { grantslipFastify } from "@grantslip/middleware";

fastify.addHook("preHandler", grantslipFastify({
  issuerUrl: process.env.GRANTSLIP_ISSUER_URL ?? "https://grantslip-issuer.fly.dev",
  audience: "tool:calendar",
  requiredScope: "calendar:read",
}));
```

`grantslipFastify` and `keyringFastify` are the same function. On allow, `request.keyring` is the claims.

Deny: HTTP **401** for `malformed`, `invalid_signature`, `expired`, and `iss`. HTTP **403** for `aud`, `scope`, `revoked`, `budget`, `pol`, and `unknown`. Body: `{ ok: false, error, message }`.

`mode: "local"` checks the signature against the issuer JWKS and `GET /v0/grants/{jti}` for revoke. It does not enforce budget or policy. The examples use issuer mode.

## Examples

| Folder | What it does |
| --- | --- |
| `examples/protected-tool` | Express and Fastify `/events` routes. Missing badge, read, wrong scope, and write. |
| `examples/mcp-server` | `tools/call` gate. `src/guard.ts` is the file to copy into a gateway. |
| `examples/runaway-agent` | Three verifies against a badge with `budget: 2`. The third is `error: "budget"`. |

`examples/mcp-server/src/guard.ts` defaults to audience `tool:<serverName>/<toolName>` and scope `<toolName>:call`. The hosted catalog does not list that pair, so the runnable script passes `audience: "tool:local"` and `scope: "local:read"`. On your own issuer, list the `tool:<server>/<tool>` scope in the catalog and omit those two fields.

## Badge claims

| Claim | Required | Notes |
| --- | --- | --- |
| `jti` | yes | Ticket id |
| `iss` | yes | Hosted issuer uses `keyring:local` |
| `sub` | yes | Agent id |
| `aud` | yes | Must match the tool |
| `scope` | yes | Space-separated capabilities |
| `iat`, `exp` | yes | Default lifetime 600 seconds |
| `budget` | no | Cap in abstract cost units, enforced on verify |
| `parent` | no | Parent ticket id. A child scope must be a subset |
| `pol` | no | Policy id, enforced on verify |

Signing is ES256. Public keys: `GET /.well-known/jwks.json`.

## Pricing

Hosted Grantslip is **$29.99/month** with a **14-day free trial**, and **$300 one-time self-host** with **12 months of updates**. The landing page is https://grantslip.com/.

## Layout

```
packages/sdk                 @grantslip/sdk
packages/middleware          @grantslip/middleware
examples/protected-tool      Express and Fastify
examples/mcp-server          MCP-style tools/call gate
examples/runaway-agent       budget stop
```

## License

MIT. Copyright 2026 James Wood / Grantslip. See [LICENSE](./LICENSE).
