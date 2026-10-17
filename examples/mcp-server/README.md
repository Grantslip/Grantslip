# MCP-style tool gate

`src/guard.ts` is the file to copy into a gateway. It uses `fetch` only. With `enabled` true, `tools/call` reaches the tool only after `POST /v0/verify` allows the badge. The badge header is `X-Keyring-Ticket`. The gateway's own `Authorization` bearer key is left alone.

From the repository root, after `pnpm install`:

```bash
pnpm build
pnpm example:mcp
```

The hosted catalog lists `tool:local` / `local:read`, `tool:calendar`, and `tool:notion`. It does not list `tool:<server>/<tool>`. This run mints `tool:local` / `local:read` and passes those as `audience` and `scope`. On an issuer that lists `tool:demo/ping` and `ping:call`, omit `audience` and `scope` and the guard uses `tool:<serverName>/<toolName>` and `<toolName>:call`.

Exit 0 prints `mcp example passed: denied, allowed`.

Revoke needs the admin secret. With it set, the script also revokes the badge and expects the next call to be denied:

```bash
GRANTSLIP_ADMIN_SECRET=your-admin-secret pnpm example:mcp
```

Replace `your-admin-secret` with the secret from your Grantslip account. Leave it unset for the quick start.
