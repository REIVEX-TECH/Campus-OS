# fix(timetable-lgu): reconcile the adapter to the real LGU portal wire format

Targets `main`. No schema change; no migration.

## What

The LGU adapter was written against the now-dead public developer API
(`lgutimetable.vercel.app`, sold — `Zain-ul-din/LGU-Timetable#40`) and its
provisional JSON fixtures. This reconciles it to the **real portal**,
`https://timetable.lgu.edu.pk`, whose endpoints are POST + form-urlencoded and
return **HTML**. The adapter stays DB-pure; the generic pipeline is unchanged.

- **Autonomous session.** The portal is not behind a login — `index.php` is a
  landing page whose "Continue to Home Page" button (`login-btn`) activates a
  fresh anonymous `PHPSESSID`. `createAutonomousSession()` mints and activates
  its own session (`GET index.php` → `POST index.php`), so no human cookie is
  needed. `LGU_PHPSESSID` is demoted to an optional override.
- **Real wire protocol** (`portal.ts`, `http.ts`, `fetch.ts`). Three POST
  endpoints (`Semester_pannel.php`, `Semesters/ajax.php`,
  `SEMESTER_TIMETABLE.php`); `crawl()` walks first semester → first degree →
  first 2–3 sections → each section's `#table-time`. The HTTP client follows
  redirects (the semester endpoint 302s) and stays polite (honest UA, delay).
  `parseOptions()` tolerates both the ajax dropdowns (closed, double-quoted) and
  the semester panel (unclosed, single-quoted `<option>`s).
- **HTML parsing** (`normalize.ts`, `schemas.ts`) with the MIT `node-html-parser`.
  `parseTimetable()` reads `#table-time`: one row per weekday, each class `<td>`
  carrying `<span>`s in order subject / room / teacher / … / **explicit
  `HH:MM - HH:MM`**. It prefers that explicit time and falls back to
  `colspan`-derived time (each `colspan` = a 30-minute session from 08:00). Empty
  room/teacher → `null` (rendered "TBA"). Every slot is zod-validated at the
  parse boundary.
- **Kind heuristic.** Course titles containing "lab" (case-insensitive) →
  `lab`, else `lecture`.
- **Real fixtures.** Provisional JSON replaced with recorded portal HTML
  (semester panel, degrees, sections, 3 section timetables). Session secrets are
  redacted and the recorder aborts on any leak; incidental chrome PII (the
  "Project Incharge" credit) is scrubbed to `REDACTED`. Recorded HTML is
  byte-for-byte and excluded from Prettier (the portal markup is malformed).
- **Attribution.** The wire protocol is ported from the MIT-licensed
  `IIvexII/LGU-TimetableAPI` (see `NOTICES.md`); the unlicensed
  `Zain-ul-din/lgu-crawler` remains unread.

## Wire — before / after

| Aspect    | Before (provisional)         | After (real portal)                                     |
| --------- | ---------------------------- | ------------------------------------------------------- |
| Transport | `GET` JSON from dev API      | `POST` form-urlencoded to `timetable.lgu.edu.pk`, HTML  |
| Session   | env `LGU_PHPSESSID` required | autonomous mint (`login-btn`); env is optional override |
| Payload   | JSON `{ combos, metadata }`  | dropdown `<option>`s + `#table-time` HTML               |
| Time      | fields in JSON               | explicit `HH:MM - HH:MM` span, `colspan` fallback       |
| Fixtures  | 3 JSON files                 | 6 recorded `.html` files                                |

## Data & migration impact

No schema change. No migration. Reconciliation is adapter-internal; the
timetable module tables, sink, and pipeline are untouched.

## Tests

- `portal.test.ts` (new) — `parseOptions` for closed/unclosed dropdowns;
  `fixtureFor` path+param → filename mapping.
- `normalize.test.ts` (rewritten) — `parseTimetable` explicit-time + `colspan`
  fallback + TBA nulls; `normalizeRecords` lab/lecture inference and batch shape.
- `source.test.ts` (rewritten) — fixture-mode `LguTimetableSource` crawls +
  normalizes the **real** recorded HTML with **zero** network.
- `session.test.ts` removed (old `establishSession` API deleted).

```bash
pnpm --filter @campusos/adapter-timetable-lgu test
pnpm turbo run typecheck lint format:check build test   # all 22 tasks green
```

## Verification

Fixture-mode ingest against `campusos_dev` (zero network):

```bash
SOURCE_MODE=fixture pnpm ingest:lgu
```

Result on a clean DB (BSCS, 1st Semester Fa-2026, 3 sections):

- **41** current entries — 26 lecture, 15 lab.
- Run stats: `inserted=41 closed=0 unchanged=0 unknowns=56` (56 emitted →
  **30 distinct** pending after the `(kind, raw_value)` dedup).
- Pending by kind: room 15, teacher 10, section 3, program 1, term 1.
- TBA: **room = 41 (100%)**, teacher = 0. Rooms are core-owned, so the timetable
  sink flags them pending instead of auto-creating — every entry shows room=TBA
  until an admin maps the 15 distinct rooms. Terms/programs/sections/courses/
  teachers are auto-created (and flagged pending for review), so teacher resolves.

## Follow-ups

- Room mapping/admin resolution UI so the 15 pending rooms clear the 100% room
  TBA; same review flow for the auto-created term/program/section/teacher rows.
- `crawl()` covers the first degree and first 2–3 sections (fixture scope); a
  full ingest should iterate all semesters × degrees × sections.
- Teacher slots occasionally hold non-person placeholders (e.g. "TA Required",
  "Fundamental Math - 1"); left as-is (faithful to source) pending a cleanup rule.
- `session-probe.ts` is now a historical diagnostic (the ANONYMOUS_OK question is
  settled); keep or drop in a later chore.
