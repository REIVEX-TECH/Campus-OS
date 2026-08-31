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

> **Host stability.** `timetable.lgu.edu.pk` intermittently round-robins between
> the real Cloudflare-fronted portal and a Vercel edge that 404s in bursts. That
> is not a block, so the session mint **retries through the blips** and the live
> client retries transient failures with backoff. A genuine block (403/429/503)
> throws `PortalBlockedError` and aborts the crawl rather than hammering.

## Crawl (full)

`crawl()` walks the **full cartesian product**: every semester, every degree
within it, every section within that, fetching each section's `#table-time`. One
bad section (or degree/section dropdown) is logged as an anomaly and skipped
(surfaced as an unmapped record), never aborting the whole crawl. Optional
politeness caps (`LGU_MAX_SEMESTERS` / `LGU_MAX_DEGREES` / `LGU_MAX_SECTIONS`)
bound it. In fixture mode a not-recorded combo is skipped silently, so replaying
a partial recorded slice yields exactly the recorded combos.

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
(autonomous — no cookie needed) records the **full** crawl via a recording HTTP
client and prints anomaly counts. Review the saved `.html` for incidental chrome
PII, and commit. Recorded HTML is byte-for-byte and excluded from Prettier. Run
it during a stable portal window (it retries the session through the Vercel-edge
blips described above).

## Ingesting

Composed at the repo root (`pnpm ingest:lgu`) so this package stays DB-free.
