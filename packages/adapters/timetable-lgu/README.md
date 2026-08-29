# @campusos/adapter-timetable-lgu

A **clean-room** adapter for Lahore Garrison University's public timetable
source. It implements the `TimetableSource` interface from `@campusos/core` —
`fetchRaw` + `normalize` — and is **pure with respect to the database**
(depends only on `@campusos/core`). The generic pipeline persists what it emits.

> Attribution, not a licence: this adapter was informed by the behaviour
> documented in `Zain-ul-din/lgu-crawler` (PHPSESSID session, metadata endpoint,
> keying scheme), but **no upstream source was copied** — that project publishes
> no licence. See [NOTICES.md](../../../NOTICES.md).

## Source modes

- `SOURCE_MODE=fixture` (default) — replays recorded responses from
  `tests/fixtures`. Used by all tests and by CI; makes **zero** network calls.
- `SOURCE_MODE=live` — fetches from `LGU_BASE_URL`. Establishes a session in
  order: (a) bootstrap a fresh PHPSESSID at the portal root and verify it with a
  metadata probe; (b) fall back to `LGU_PHPSESSID`; (c) if both fail, abort
  before writing anything and print a recovery procedure. The chosen path is
  logged every run.

## Concurrency

Combos are fetched through a bounded async queue (replacing the upstream's Node
`cluster`). The default limit is **4** concurrent requests (`LGU_CONCURRENCY`),
chosen to stay polite to a single university portal; requests carry a real
User-Agent with a contact URL.

## Recording fixtures (run locally, never in CI)

```bash
SOURCE_MODE=live pnpm --filter @campusos/adapter-timetable-lgu record:fixtures
```

Scrub any PII and any real PHPSESSID before committing recorded fixtures. The
hand-written fixtures currently checked in let all tests run today; your recorded
ones replace them.

## Ingesting

Ingestion is composed at the repo root (`pnpm ingest:lgu`) so this package stays
DB-free. See the root README.
