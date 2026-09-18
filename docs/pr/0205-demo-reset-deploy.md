# feat(demo): reset script and deploy runbook (E, F)

Run 5, PR 4 (final build PR). A one-command reset for the demo tenant and the runbook
that documents standing it up and operating it. LGU is untouched.

## What

- `scripts/demo/reset.ts` — `wipeDemo(sql)` deletes every `tenant_id = 'demo'` content
  row across the module tables in child-before-parent order, and `resetDemo(sql)` wipes
  then re-runs `seedDemo` (reused from PR 2). `scripts/demo-reset.ts` + the `demo:reset`
  package script — the owner-run entry.
- `docs/runbooks/demo-tenant.md` — deploy notes: the host resolves through the existing
  wildcard (no DNS/cert/nginx/env change); `pnpm demo:seed` / `pnpm demo:reset`; where the
  banner copy lives and how it reaches the DB (the seed/migration path, never by hand);
  and the optional `-- --tenant demo` maintenance cron lines.

## Behavior

`resetDemo` is owner-run, idempotent, and scoped to `demo` only — every delete is
`where tenant_id = 'demo'`, so it can never touch LGU or any other tenant. The seeded
persona accounts (platform-level `users`) are kept and re-seeded idempotently, so no
`users` rows are deleted (avoiding cross-tenant FK surprises). After a reset the tenant
holds exactly the seeded fixtures again.

## Data & migration impact

No schema change. Tooling + docs only; nothing runs automatically.

## Security review (CLAUDE.md 6, 8)

No new definer, policy, or grant. The reset only deletes demo-scoped content and re-runs
the existing seed. Deletes on FORCE content tables are scoped by `app.tenant_id = 'demo'`;
the value is bound (never interpolated), and the table list is a fixed allowlist.

## Tests / verification

Verified locally against real Postgres: `pnpm demo:reset` runs clean and returns the
tenant to its exact seeded counts (e.g. after a reset from a dirtied state, campuses back
to 1, courses 4, posts 5, listings 5, rides 3, timetable entries 6 — the debris of manual
experiments gone). `turbo` typecheck/lint unaffected (script + docs only); the scripts
pass eslint + prettier and run under `tsx`.

## Follow-ups

None for the demo build — this completes A–F and G–H. The morning REPORT summarizes the
run and how to stand the demo up.
