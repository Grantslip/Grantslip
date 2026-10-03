# Grantslip

Short-lived visitor badges for AI agents — one tool, one scope, a few minutes; no standing API key in the runtime.

## The loop

1. **Mint** — the agent asks for a ticket scoped to one tool and a short TTL.
   Each tool lists the permissions it offers, and Grantslip turns down any badge request for a permission that isn't on that list. Anyone can look up a tool's list at `GET /v0/catalog` on the issuer.
2. **Verify** — the tool host checks the ticket before executing.
3. **Revoke** — pull the badge the moment something looks wrong.
4. **Receipt** — every allow or deny is logged immutably.

## Why it exists

Agents calling tools with permanent keys is a known failure mode — prompt injection, leaked context, runaway loops. Grantslip gives you containment and an audit trail without handing the agent a key it can never lose.

## Quick start

```bash
pnpm install
```

```bash
pnpm demo
```

`pnpm demo` runs the full loop in-process (mint, narrow scope, revoke, expiry, budget); exit code 0 only if every flow passes.

Hosted verify — try free two weeks at https://grantslip.com/ then $199/mo per gateway team.

## Links

Landing https://grantslip.com/ · Issuer API https://grantslip-issuer.fly.dev/

## Built by

I spent my career as a train engineer, where a mistake can cost lives. You learn to give access only when it's needed, take it back when the job's done, and keep a record of all of it. I built Grantslip with AI coding tools to bring that same discipline to AI agents: short-lived badges, only the tools they need, and a log of every use.
