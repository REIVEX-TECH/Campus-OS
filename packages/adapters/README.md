# packages/adapters

Container for data-source adapters. **One package per source**, e.g.
`packages/adapters/timetable-lgu` (`@campusos/adapter-timetable-lgu`).

An adapter implements a source interface defined in `@campusos/core`
(`fetchRaw → normalize`) and returns normalised records. Adapters are **pure
with respect to the database**: they never write to Postgres. The generic
ingestion pipeline in core persists what they emit (`diff → upsert with
versioning → write ingestion_runs`).

Rules:

- Adapters depend only on `@campusos/core` (types/interfaces) — never on
  `@campusos/db` or on a module.
- Scrapers must be polite: real User-Agent with a contact URL, respect rate
  limits, back off on errors, cache aggressively.
- CI never hits a live source; tests replay recorded fixtures.
