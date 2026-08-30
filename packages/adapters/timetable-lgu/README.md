# @campusos/adapter-timetable-lgu

An adapter for Lahore Garrison University's timetable **portal**
(`https://timetable.lgu.edu.pk`). It implements the `TimetableSource` interface
from `@campusos/core` — `fetchRaw` + `normalize` — and is **pure with respect to
the database** (depends only on `@campusos/core`). The generic pipeline persists
what it emits.

> **Attribution.** The portal wire protocol (endpoints, POST + form body, session
> behaviour, and the `#table-time` HTML structure) is ported from
> [`IIvexII/LGU-TimetableAPI`](https://github.com/IIvexII/LGU-TimetableAPI),
> which is **MIT-licensed** — see [NOTICES.md](../../../NOTICES.md). The
> unlicensed `Zain-ul-din/lgu-crawler` is **not** read or copied.

## Session strategy (autonomous)

The portal is **not** behind a login. `index.php` is a landing page whose
"Continue to Home Page" button (`<form action="index.php">`, submit `login-btn`)
activates a fresh anonymous session. The adapter mints its own:

- **Live mode is autonomous** — `createAutonomousSession()` does `GET index.php`
  → `POST index.php` with `login-btn=`, yielding an activated `PHPSESSID` that the
  data endpoints accept. No human credential is required.
- `LGU_PHPSESSID` is an **optional override** only (e.g. to reuse a browser
  session). Leave it unset for the normal flow. When set, it is used verbatim
  and the mint step is skipped.
- `healthCheck()` mints a session to confirm portal reachability without fetching
  data.

## Source modes

- `SOURCE_MODE=fixture` (default) — replays recorded responses from
  `tests/fixtures`; **zero** network calls. Used by all tests and CI.
- `SOURCE_MODE=live` — mints an autonomous session, then POSTs to the portal
  (or uses `LGU_PHPSESSID` if provided).

## Concurrency & politeness

Requests use a bounded async queue (default **4**, `LGU_CONCURRENCY`) with an
honest User-Agent (contact URL) and delays between requests.

## Recording fixtures

See [docs/recording-fixtures.md](../../../docs/recording-fixtures.md). In short:
`SOURCE_MODE=live pnpm --filter @campusos/adapter-timetable-lgu record:fixtures`
(autonomous — no cookie needed), review the saved `.html` for incidental chrome
PII, and commit. Recorded HTML is byte-for-byte and excluded from Prettier.

## Ingesting

Composed at the repo root (`pnpm ingest:lgu`) so this package stays DB-free.
