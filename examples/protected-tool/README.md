# Protected tool

An Express server and a Fastify server. Both use `@grantslip/middleware` on `/events`.

- `GET` requires `calendar:read`
- `POST` requires `calendar:write`

From the repository root, after `pnpm install`:

```bash
pnpm build
pnpm example:protected
```

The script mints both badges on the hosted issuer (`https://grantslip-issuer.fly.dev`), calls each server, and exits 0 when both servers deny a missing badge, allow a read, deny a read used as a write, and allow a write.

```bash
GRANTSLIP_ISSUER_URL=https://grantslip-issuer.fly.dev pnpm example:protected
```

Mint and verify need no key.
