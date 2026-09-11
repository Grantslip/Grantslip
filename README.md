## Hi there 👋
Grantslip
Short-lived "visitor badges" for AI agents. One tool, one scope, a few minutes — no standing API key in the runtime.
The loop
Mint — agent asks for a ticket scoped to one tool and a short TTL.
Verify — the tool host checks the ticket before executing.
Revoke — pull the badge the moment something looks wrong.
Receipt — every allow or deny is logged immutably.
Why it exists
Agents calling tools with permanent keys is a known failure mode — prompt injection, leaked context, runaway loops. Grantslip gives you containment and an audit trail without handing the agent a key it can never lose.
Quick start
pnpm install
pnpm demo
pnpm demo runs the full loop in-process: mint, narrow scope, revoke, expiry, budget. Exit code 0 only if every flow passes.
Links
Landing page: https://grantslip.fly.dev/
Issuer API: https://grantslip-issuer.fly.dev/
Built by
A retired train engineer with no AI experience, brainstormed with an AI.

<!--
**Grantslip/Grantslip** is a ✨ _special_ ✨ repository because its `README.md` (this file) appears on your GitHub profile.

Here are some ideas to get you started:

- 🔭 I’m currently working on ...
- 🌱 I’m currently learning ...
- 👯 I’m looking to collaborate on ...
- 🤔 I’m looking for help with ...
- 💬 Ask me about ...
- 📫 How to reach me: ...
- 😄 Pronouns: ...
- ⚡ Fun fact: ...
-->
