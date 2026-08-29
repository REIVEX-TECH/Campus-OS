# @campusos/module-timetable

The Timetable module: the canonical timetable domain, schema, and repositories.
No UI and no scraping live here — an adapter emits normalized records and the
core ingestion pipeline persists them through this module's sink.

## What's here

- **schema/** — tenant-scoped tables: `academic_terms`, `departments`,
  `programs`, `sections`, `courses`, `teachers`, `timetable_entries` (versioned),
  `ingestion_runs`, `source_snapshots`, `user_saved_sections`,
  `change_subscriptions`, and `unmapped_source_values` (pending admin review).
- **domain/** — pure, unit-tested logic: `computeContentHash`,
  `planTimetableDiff`, `detectConflicts`, `freeRooms`.
- **repositories/** — tenant-bound reads (`bySection`/`byTeacher`/`byRoom`,
  `findFreeRooms`, `findConflicts`) and the versioned `applyDiff` transition.
- **manifest** — the module manifest (`@campusos/module-timetable/manifest`),
  including the migrations folder the orchestrator runs after the base schema.

## Versioning & idempotency

`timetable_entries` is versioned with `valid_from`/`valid_to`; nothing is
hard-deleted. `content_hash` makes ingestion idempotent. See
[docs/versioning.md](docs/versioning.md) for how "current" is queried, how a
change is detected, and the exact hashed field list.

## Tests

```bash
pnpm --filter @campusos/module-timetable test               # domain unit tests
pnpm --filter @campusos/module-timetable test:integration   # repositories (Postgres)
```
