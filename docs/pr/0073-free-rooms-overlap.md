# fix(timetable): free rooms and a room's own page now agree

Targets `main`. Correctness hotfix: students were being sent to occupied rooms.

## The bug

`/rooms/free` for Monday 09:30 to 11:00 listed Lab 15 NB as free and reported
92 of 94 rooms free, while `/rooms/<lab 15 nb>` showed Human Computer
Interaction in that room at exactly that time. Two queries answered the same
question differently.

## Root cause

Both pages read the same rows, with one difference:

- the room page's schedule is **every current entry for the room**
  (`room_id = ?` and `valid_to is null`), across every term;
- the free-rooms page filtered occupancy by **one term**,
  `listTermsWithSections()[0]`, which is the alphabetically first term that has
  sections.

Production has more than one term with sections, and the live classes sit in a
term that does not sort first, so the free-rooms query saw only a sliver of the
timetable. Everything outside that term "escaped", and a room with a class in
it was free by omission. The two busy rooms it did find were the two entries
that happened to live in the term it picked.

The overlap predicate, the ISO weekday mapping, the 24 hour time parsing and the
tenant timezone for "free now" were each checked as suspects and are all
correct; regression tests now pin each of them so a future break lands on a red
test rather than on a student.

## The fix

Occupancy has one definition now, in the read model: `occupancy(dayOfWeek)`,
every current class with a resolved room on that weekday, in any term. The
free-rooms query is built on it and takes no term at all. It reads exactly the
rows the room page reads, so the two can only disagree by disagreeing with
themselves.

The interval arithmetic that decides "busy" and "free" moved into the module
(`domain/intervals.ts`: merge, busy stretches, half-open overlap, free gaps)
and the teacher and room profiles' free-slots and utilisation figures now use
it instead of their own copy. One implementation, three consumers.

`freeRooms` no longer accepts a `termId`; both callers were updated. The terms
list still decides whether a timetable exists at all, which is the only thing it
was ever right about.

## Data & migration impact

No schema change. No storage touched.

## Tests

- Unit, `freeRooms`: a Monday 09:30 to 11:00 class makes the room **busy** for
  09:30 to 11:00, 10:00 to 10:30, 09:00 to 10:00, 10:30 to 12:00 and 09:00 to
  12:00, and **free** for 08:00 to 09:30 and 11:00 to 12:30 (adjacent is not an
  overlap); seconds from the database (`09:30:00`) parse the same; a Monday
  class never blocks Tuesday and vice versa, and Sunday is 7, never 0.
- Unit, intervals: merge, clipping, the half-open overlap on all six edges,
  free gaps as the complement, overlap counted once in totals.
- Unit, `tenantNow`: with the clock frozen at Sunday 21:30 UTC, Karachi is
  Monday 02:30 and UTC is Sunday 21:30; ISO weekdays; midnight is minute zero.
- Integration: **a current class in a different term makes the room busy** for
  the four overlapping windows and not for the two adjacent ones, and the room's
  own page lists the same class; a closed version (`valid_to` set) does not keep
  a room busy. Ran locally against the test database as well as in CI.
- e2e: the number in the summary equals the number of rooms listed.
- `pnpm turbo run typecheck lint test` (23 tasks), `pnpm --filter web build`,
  `pnpm --filter web test:e2e` (58) pass.

## The production check you asked for

I do not run queries against production. This is the exact query, in a tenant
context, for you to run before and after deploying; it is the same predicate the
code now uses:

```sql
set app.tenant_id = 'lgu';
with busy as (
  select distinct e.room_id
  from timetable_entries e
  where e.valid_to is null and e.day_of_week = 1
    and e.starts_at < '11:00' and e.ends_at > '09:30'
    and e.room_id is not null
)
select (select count(*) from rooms r where r.deleted_at is null) as rooms_total,
       (select count(*) from busy) as busy_rooms,
       (select count(*) from rooms r where r.deleted_at is null) - (select count(*) from busy) as free_rooms,
       exists (select 1 from busy b join rooms r on r.id = b.room_id where r.name = 'Lab 15 NB') as lab_15_nb_is_busy;
```

Expected after deploy: `free_rooms` far below 92 and `lab_15_nb_is_busy = true`.
The page will show the same `free_rooms` number. If you also want to see the
old answer for comparison, add `and e.term_id = (select id from academic_terms
where deleted_at is null order by name limit 1)` to the `busy` CTE.

## Follow-ups

- Why production has more than one term with sections is worth a look at the
  ingestion side: a term label that changed shape between runs would do it.
  Out of scope here; the read model is now correct whichever way that goes.
- The `minutes()` helper in `apps/web/app/_components/views/time-scale.ts` is
  a third copy of `toMinutes`; the grid still uses it. Fold it into the module
  in the 12 hour format pass, which touches that file anyway.
