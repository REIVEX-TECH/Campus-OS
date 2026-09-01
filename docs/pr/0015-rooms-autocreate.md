# feat(timetable): auto-create rooms from crawled names (kill room=TBA)

Targets `main`. Core of a two-part change; the admin rooms list + rename follow
in PR B. Ships a schema column (module migration), a normalized dedup helper, the
sink change, and a one-shot backfill. Deploy order on the VPS:
`pnpm db:migrate:all && pnpm backfill:rooms && rebuild`.

## Why

Rooms were the one crawled dimension the sink did NOT auto-create: an unknown
room string was left `room_id` NULL (rendered TBA) plus an
`unmapped_source_values` row for a human to "map". But room names always come
from the crawler and are trusted, so that mapping was busywork and every class
showed TBA until someone clicked through it. Teachers already auto-create; rooms
now do too.

## What

- **Normalization + dedup key** (`domain/room-key.ts`): `roomDedupKey(raw)`
  case-folds, NFKC-normalizes, and collapses every run of non-alphanumeric
  characters to a single `-` (Unicode letter/number classes, so non-ASCII names
  are not stripped). Formatting variants collapse: `"Lab 15 NB"` and `"LAB-15-NB"`
  both give `lab-15-nb`; `"Kitchen Lab"` and `"kitchen lab "` both give
  `kitchen-lab`. `roomDisplayName(raw)` keeps the original (trimmed, whitespace
  collapsed); first seen wins per key. A blank or punctuation-only string yields
  `''`, which the caller treats as "no room" (the TBA safety valve).
- **Schema** (`rooms.dedup_key`): a nullable match key, decoupled from the
  renamable display `name`. Added by a base migration
  (`db/drizzle/0002_room_dedup_key.sql`, `ADD COLUMN IF NOT EXISTS`), with a
  belt-and-braces guard in the backfill (see "Migration note").
- **Sink** (`ingestion/sink.ts`): a crawled room string is normalized to a dedup
  key; an existing room with that key is reused, otherwise a canonical room is
  created (display name preserved, `dedup_key` set) and linked. The blank-room
  safety valve is the `if (e.roomName)` guard plus the empty-key check, so a
  genuinely blank source room stays `room_id` NULL / TBA. The old
  `recordUnmapped('room', …)` and the resolved-alias self-heal map are gone.
- **ensureBuilding bug-fix + share** (`ingestion/ensure-building.ts`): the old
  `ensureBuilding` did `SELECT … FROM buildings LIMIT 1`, so on a multi-building
  tenant it attached auto-created rooms to an arbitrary building. The shared
  helper find-or-creates the `"Unassigned Building"` BY NAME. Both the sink and
  the (legacy) `resolveRoom` use it.
- **Backfill** (`scripts/backfill-rooms.ts` + `AdminRoomsRepository.backfillRooms`):
  a `withTenant` script (NOT a migration, which runs with no tenant context so
  RLS would silently touch zero rows). It populates `dedup_key` on existing rooms,
  then for each pending `kind='room'` value finds-or-creates the canonical room by
  key, relinks the current TBA entries carrying that raw string (recomputing
  `content_hash` in place so a following ingest is a no-op), and marks the value
  resolved. Touches only `status='pending'` rows; idempotent. If a relink would
  land on a `content_hash` a current entry already holds (the same slot was
  crawled under two spellings, one of which had already matched the room by its
  old case-insensitive name), the duplicate is closed instead of relinked, so it
  never collides with the `tt_entries_current_hash_uq` partial unique index. This
  was found by an adversarial review of the change.

The read layer needs no change: a real `room_id` renders the room name instead of
TBA, and rooms carry no status so they never trigger a pending badge.

## Migration note (base migration + backfill guard)

`rooms` is a core table, so `dedup_key` is declared in the core schema and added
by a base migration; the `@campusos/db` isolation test (which runs only base
migrations) therefore has the column, and every fresh database and new install
gets it. There is a wrinkle: the base and module migration folders share one
drizzle watermark table, whose watermark is already at the module's timestamps,
so on an ALREADY-migrated database (production) this new base migration is
silently skipped. The one-shot backfill (which the operator runs on that upgrade,
before the next ingest) therefore begins with an idempotent
`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS dedup_key text`, so the column is
guaranteed present there too. Fresh-DB migration and the column-present path are
both verified by the integration suites against a freshly reset database. The
shared-watermark limitation is a pre-existing infra smell worth fixing separately
(see Follow-ups).

## Data & migration impact

Additive: `ALTER TABLE rooms ADD COLUMN dedup_key text` (nullable, backwards
compatible). No unique index yet (added in PR B once existing rooms are deduped;
the sink dedups in-process for the single-writer ingest). The backfill mutates
data (creates rooms, sets `room_id` + recomputed `content_hash`, flips pending
values to resolved) and is idempotent. Rollback: drop the column; populated
`room_id` values are harmless. Note (expected, acknowledged): the first live
ingest after rollout may ADD entries for a slot the source lists in two rooms
(previously deduped to one TBA entry because `room_source` is not hashed). That is
more-correct data, not churn.

## Tests

- Unit `test/room-key.test.ts`: the example pairs collapse to one key; distinct
  rooms stay distinct; blank/punctuation gives `''`; non-ASCII preserved; display
  name preserved.
- Integration `test/room-autocreate.integration.test.ts`: auto-create links the
  entry with the display name preserved and no pending row; messy variants dedup
  to one room; blank source stays TBA with no room; re-ingest is idempotent (no
  churn, no duplicate room); tenant isolation (RLS).
- Integration `test/backfill-rooms.integration.test.ts`: old-world pending state
  is resolved in place with the hash equal to `computeContentHash(…roomId)`;
  variants dedup; idempotent; tenant isolation.
- Removed `test/admin-rooms.integration.test.ts` (its pending/resolve flow is
  obsolete under auto-create; the same relink+rehash invariant is covered by the
  backfill test).

Commands: `pnpm turbo run typecheck lint format:check test build`,
`pnpm --filter @campusos/module-timetable test:integration`.

## Verification steps

Local: `pnpm --filter @campusos/module-timetable test:integration` (16 pass).
`SOURCE_MODE=fixture pnpm ingest:lgu` then confirm entries carry a room and no
`kind='room'` pending rows remain. On an old DB: `pnpm db:migrate:all` then
`pnpm backfill:rooms` and confirm TBA is gone.

## Follow-ups

- PR B: iOS read-mostly rooms admin + rename (merge as a later fast-follow),
  which also adds the partial unique index on `(tenant_id, dedup_key)` after
  deduping existing rooms, and soft-delete filtering on room reads.
- Give the base and module migration folders separate drizzle watermark tables so
  base migrations added later are not skipped.
- Teacher names still dedup by exact string (same latent duplicate risk); a shared
  normalized key is a natural follow-up.
