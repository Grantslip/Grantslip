# Runaway agent

Mints a `tool:notion` / `notion:read` badge with `budget: 2`, then verifies it with `cost: 1` in a loop. The first two calls are allowed. The third is denied with `error: "budget"`, and the loop stops.

From the repository root, after `pnpm install`:

```bash
pnpm build
pnpm example:runaway
```

```bash
GRANTSLIP_ISSUER_URL=https://grantslip-issuer.fly.dev pnpm example:runaway
```

Mint and verify need no key. Exit 0 prints `runaway agent stopped: budget`.
