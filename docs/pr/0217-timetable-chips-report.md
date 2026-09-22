# docs(overnight): timetable chips morning report

The morning report for the timetable-chips run. Docs only.

## What

- `docs/overnight/REPORT.md` — replaced with this run's report: the PR table with SHAs,
  what shipped (design + signal engine + dismissals), what is deferred and why, the four
  foundational decisions needed (the `platform_events` design, the platform account, the
  rides campus-endpoint gap, and where the admin panel lives), deploy steps, the
  `is_platform` grant caveat, per-signal read-only LGU probes, the browser checklist, and
  the risks.

## Headline

Most of the run's telemetry, feedback card, and admin panel depend on infrastructure that
does not exist (`platform_events` + `record_platform_event` + cap, `users.is_platform`,
`/u/[slug]/admin/feed-cards`), and the `rides-after-class` signal hits a data gap (no
structured campus endpoint). The run shipped the parts that do not depend on the missing
foundation (design, the pure signal engine, the per-day dismissals) and deferred the rest
with a concrete proposal, rather than invent an events subsystem and a platform-account
flag overnight.

## Data & migration impact

No schema change. Docs only.

## Tests / verification

`prettier --check` passes.
