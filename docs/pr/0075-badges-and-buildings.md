# fix(timetable): one pending note per schedule, and buildings inferred from room names

Targets `main`. Two consistency items from the free-rooms and time-format pass.

## 1. Teacher and room schedules lose the per-row "Unverified" badge

The section timetable already showed a single quiet note above the schedule
("Some classes are imported automatically and are pending review.") and no
badge on each row. Teacher and room pages still badged every class. They now get
the same treatment: `FilterableTimetable` renders the one note when any class is
pending, and `EntryRow` no longer renders a badge.

The teacher profile's own `PendingBadge`, on the header beside the name, stays:
that is the teacher record's status, not a per-class repeat.

## 2. Every room showed "Unassigned Building"

LGU room names carry a block suffix: "Lab 15 NB", "Room 25 NB", "Lab 18 OB".
That trailing code is the only building signal a crawl carries, so it becomes
the building.

- `inferBuildingCode(name)`: the last token of the name when it is two or three
  capital letters and the name has more than one token. "Lab 15 NB" gives `NB`;
  "Kitchen Lab", "Room 101", "Lab 15 nb" and a bare "NB" give nothing.
- `ensureBuildingForRoom` is the one decision both the ingest sink and the
  backfill make: the building for that code (find-or-create, keyed on
  `buildings.code`, display name starting as the code), or the unassigned
  placeholder when the name declares none. **The safety valve is kept**: a room
  with no recognisable suffix stays unassigned rather than guessed.
- `backfillRooms` gains a step that moves live rooms out of the placeholder into
  the building their name declares, counted as `buildingsAssigned`. Idempotent:
  a moved room is no longer in the placeholder.
- The rooms admin gets a **Buildings** section: each building with its code and
  room count, and a rename form. Renaming changes the display name only; the
  code is never touched, so later crawls still resolve to the same building.
  Gated exactly like renaming a room: origin, a per client limit, then the role
  on the mutation itself, 404 without it.
- The rooms directory already showed the building only when it varied across
  rooms, so after the backfill it appears on room cards by itself.

## Data & migration impact

No schema change: `buildings.code` already existed and was unused. One human
step after deploy, the existing one:

```
INGEST_TENANT=lgu pnpm backfill:rooms
```

It prints `buildings=N` for the rooms it moved. Rollback is
`update rooms set building_id = (select id from buildings where name = 'Unassigned Building' and tenant_id = 'lgu') where tenant_id = 'lgu'`,
which puts every room back where it was; the inferred buildings can then be
deleted or left.

## Tests

- Unit: `inferBuildingCode` reads `NB`, `OB`, a three letter code, tolerates
  extra spaces; refuses no suffix, a numeric suffix, lower case, a single letter,
  and a bare code.
- Integration (ran locally, 4 files): ingest files "Lab 15 NB" and "Room 25 NB"
  under one `NB` building and "Lab 18 OB" under `OB`; "Kitchen Lab" stays
  unassigned; the backfill moves an unassigned room with a code into its
  building once and then reports zero; a building renames without losing its
  code; **one tenant cannot rename another tenant's building**. The rooms admin
  list test now expects `NB` for "Room 25 NB" instead of the placeholder.
- e2e (2 new, 64 total): a teacher schedule and a room schedule each carry the
  note exactly once and no row carries "Unverified".
- `pnpm turbo run typecheck lint test` (23 tasks), `pnpm --filter web build`,
  `pnpm --filter web test:e2e` (64) pass.

## Verification steps

1. A teacher page and a room page: one note above the schedule, no badge on any
   row. The teacher header still shows the teacher's own pending badge if that
   record is pending.
2. After `pnpm backfill:rooms` on the VPS: `/rooms` cards show `NB` or `OB` under
   each room; `/admin/rooms` lists the buildings with counts; rename `NB` to
   "New Block" and the cards follow.

## Follow-ups

- Building names default to their code ("NB") until an admin names them; a
  seed of known LGU names would be a one-line tenant setting later.
- The rooms admin pages still gate on `requireTenantAdmin`; they move to
  `requirePermission(slug, 'manage-rooms')` in platform admin Phase 2.
