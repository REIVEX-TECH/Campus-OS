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

## The portal needs a login (session strategy)

The portal serves **no timetable data without an authenticated session**
(verified: an incognito visit to `timetable.lgu.edu.pk` shows no data). Therefore:

- **Live mode always requires `LGU_PHPSESSID`** — an authenticated session cookie
  supplied via env (`.env` locally, an Actions secret in CI). There is no way to
  mint a working session unauthenticated.
- The old "bootstrap-mint" path is **demoted to a health probe** only: it can
  check portal reachability, but a real session must come from `LGU_PHPSESSID`.
  If it's missing/expired, live mode aborts before writing anything.

### Refreshing the session (human step)

Sessions expire; refresh them by hand:

1. Log in to `https://timetable.lgu.edu.pk` in a browser.
2. DevTools → Application → Cookies → copy the **`PHPSESSID`** value.
3. Set it in `.env` (`LGU_PHPSESSID=…`) for local runs, or update the repo/Actions
   secret for scheduled ingestion. Never paste it into chat or commit it.

## Source modes

- `SOURCE_MODE=fixture` (default) — replays recorded responses from
  `tests/fixtures`; **zero** network calls. Used by all tests and CI.
- `SOURCE_MODE=live` — POSTs to the portal with the env session cookie.

## Concurrency & politeness

Requests use a bounded async queue (default **4**, `LGU_CONCURRENCY`) with an
honest User-Agent (contact URL) and delays between requests.

## Recording fixtures (local only)

See [docs/recording-fixtures.md](../../../docs/recording-fixtures.md). In short:
put a fresh `LGU_PHPSESSID` in `.env`, then
`pnpm --filter @campusos/adapter-timetable-lgu record:fixtures`, review the saved
`.html` for PII, and commit.

## Ingesting

Composed at the repo root (`pnpm ingest:lgu`) so this package stays DB-free.
