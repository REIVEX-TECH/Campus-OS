# feat(demo): real users are read-only on the demo tenant (H)

Run 5, PR 3. Enforces the demo guardrail server-side: on a demo tenant, only seeded
personas may mutate; every real signed-in user is read-only. Reads are unchanged, and
no ordinary tenant (LGU) is affected.

## What

- `apps/web/lib/demo.ts` — `demoReadOnly(tenant, actor)`: returns a `403` Response when
  `tenant.isDemo && !actor.isDemo`, else null. One choke point.
- Wired into every mutation gate right before it admits the request: `communityGate`,
  `lostFoundGate`, `marketplaceGate`, `marketplaceServicesGate`, `ridesGate`,
  `messagesGate`. The read gate (`messagesReadGate`) is deliberately left alone, so
  reads are untouched.
- `apps/web/test/demo.test.ts` — the boundary test.

## Why the gate is the right layer

Every mutating API route passes through its module's `xGate` before doing anything, so
a check there is a real server-side boundary (hitting the API directly does not get
around it) — "at the API definer / gate, not just the UI", as required. Because all six
gates call the one `demoReadOnly`, the rule cannot drift between modules. Since
`messaging` a persona is itself a mutation, "no messaging seeded users" falls out of the
same rule (a real user cannot start or send a message on demo at all).

## Security review (CLAUDE.md 6, 8)

- Both inputs are unforgeable by a real user: `tenant.isDemo` is from the tenant config
  (platform-admin-write, definer-guarded), and `actor.isDemo` is from the user's own row,
  which the RESTRICTIVE policy from PR 1 (identity 0034) stops the app role from ever
  setting true. So a real user cannot flip either input to escape the rule.
- The rule is explicit and independent of verification: it holds even if a real user
  were somehow verified on demo (they are not, by the closed join), so the demo cannot be
  mutated by construction.
- No new definer, policy, or grant.

## Tests / verification

`apps/web/test/demo.test.ts` (the boundary proof at the shared choke point every gate
calls): a real user on a demo tenant is blocked with a 403 (`demo_read_only`); a persona
on demo is allowed; a real user and a persona on a non-demo tenant are both allowed.
Web typecheck + lint + prettier pass; the full web vitest suite is green.

## Follow-ups (this run)

PR 4 — the reset script (E, reusing `seedDemo`) and the runbook / deploy notes (F), then
the morning REPORT.
