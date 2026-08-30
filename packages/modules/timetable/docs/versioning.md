# Timetable versioning & change detection

The timetable is **append-only and versioned**. Reference data (terms,
departments, programs, courses, teachers, sections) is soft-deleted
(`deleted_at`); the schedule itself (`timetable_entries`) is bitemporally
versioned with `valid_from` / `valid_to`. Nothing is hard-deleted.

## Querying "current"

An entry is current when its validity is open:

```sql
SELECT * FROM timetable_entries
WHERE section_id = $1 AND valid_to IS NULL;
```

To see the schedule **as it was** at a past instant `T`:

```sql
SELECT * FROM timetable_entries
WHERE section_id = $1
  AND valid_from <= T
  AND (valid_to IS NULL OR valid_to > T);
```

The repositories (`bySection`, `byTeacher`, `byRoom`) return current entries.

## Detecting a change

Ingestion is a diff against the current set, scoped to a term:

1. Each incoming slot is reduced to a **content hash** (below).
2. Load the current entries for the scope (`valid_to IS NULL`) and their hashes.
3. Compare the two sets of hashes:
   - hash present incoming, absent current → **insert** a new current row
     (`valid_from = now()`);
   - hash present current, absent incoming → **close** the old row
     (`valid_to = now()`);
   - hash in both → **unchanged**, left untouched.

This is `planTimetableDiff` (pure) applied by `TimetableRepository.applyDiff`
inside a single tenant transaction. Re-applying an identical snapshot is a
no-op (0 inserted, 0 closed), which makes ingestion idempotent. The partial
unique index `(tenant_id, content_hash) WHERE valid_to IS NULL` enforces "at
most one current row per identical slot" at the database level.

A closed-then-reopened slot (same content reappears later) inserts a fresh
current row, so the history reads as: valid → closed → valid again.

## content_hash — exact field list

`content_hash = sha256( join(SEP, [...]) )` over these fields, in this order:

1. `term_id`
2. `section_id`
3. `course_id`
4. `teacher_id` (empty string when null)
5. `room_id` (empty string when null)
6. `day_of_week` (ISO 1–7)
7. `starts_at` (normalized to `HH:mm:ss`)
8. `ends_at` (normalized to `HH:mm:ss`)
9. `kind`

**Excluded, and why:**

- `tenant_id` — redundant: per-tenant uniqueness is enforced by the
  `(tenant_id, content_hash)` partial unique index, and every diff is already
  tenant + term scoped.
- `source_ref` — provenance/traceability; the same logical class can be re-keyed
  upstream without being a real change.
- `valid_from` / `valid_to` / `created_at` / `id` — temporal/identity, not content.

Because `source_ref` is excluded, a slot whose only change is its upstream key is
treated as unchanged (correct). Because everything else material is included, any
real change (room move, teacher swap, time shift, kind change) produces a new
hash and therefore a new version.
