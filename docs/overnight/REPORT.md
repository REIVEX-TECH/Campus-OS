# Overnight run — timetable contextual chips — morning report

## Read this first: the run is built on infrastructure that does not exist

Most of tonight's directive stands on three things that are **not in the repository** (I
searched all source, docs, and branches):

- **`platform_events` + `record_platform_event` + the per-user cap** — absent. The
  carryover ("confirm the cap counts the actor's own rows; add an A-vs-B test") has nothing
  to confirm or test: there is no such table or function. The only `count(*)` definer is
  `0011_activity_timing` (active-user analytics), unrelated.
- **`users.is_platform`** — absent. The report's `UPDATE users SET is_platform=true` and the
  feedback card's "message the platform account" both assume a column that is not there.
  What exists: `is_official` (Run 6, official-account badge) and `platform_roles` /
  `isPlatformAdmin()` (platform-admin role) — different concepts.
- **`/u/[slug]/admin/feed-cards` page + "announcement metrics"** — absent. Admin pages:
  analytics, communities, join-policy, members, platform-access, roles, rooms, verification.

I did **not** invent an events subsystem (a `SECURITY DEFINER` writer whose cap semantics
you flagged as delicate), a platform-account flag, and an admin analytics page overnight,
undesigned — that is a large §6 surface, against "keep it small," and you have a specific
design in mind (you named `record_platform_event` and its cap rule). So this run built the
parts that do **not** depend on the missing foundation and deferred the rest with a concrete
proposal, for your decision.

A second gap surfaced while scoping the signals: **rides have no structured "campus
endpoint"** (only free-text `origin_text`/`dest_text` + optional coords). So the
`rides-after-class` signal's "leaving campus" filter cannot be computed faithfully without a
rides schema change or a fragile text heuristic — a decision for you (below).

## PRs (SHA per PR)

| PR   | SHA       | What                                                                     | CI    |
| ---- | --------- | ------------------------------------------------------------------------ | ----- |
| #246 | `93820f8` | docs: design pass (`docs/design-timetable-chips.md`) + decisions         | green |
| #247 | `81c0204` | feat: signal engine (pure, fixture-tested) + `timetable_chip_dismissals` | green |
| #248 | this PR   | docs: this report                                                        | green |

## What shipped

- **Design** (`docs/design-timetable-chips.md`): data model, the four signals, ranking,
  per-user-per-day dismissal, the (deferred) telemetry, empty-state, mobile — and the
  buildable-vs-blocked split.
- **Signal engine** (`apps/web/lib/chips/signals.ts`): pure, deterministic
  `marketplaceCourseMatch` / `lostfoundBuildingMatch` / `ridesAfterClass` /
  `freeWindowToday` + `chipsForStudent` (rank marketplace > lost-found > rides >
  free-window, drop dismissed kinds, one chip, none when no classes today). 16 unit tests.
- **Dismissals** (`identity 0037` + `src/chips.ts`): `timetable_chip_dismissals`, own-row
  FORCE RLS, written through the `record_timetable_chip_dismissal` self-write definer.
  Integration test proves per-day, own-row, definer-stamped, no cross-user forge.

## Deferred (blocked; proposed, not built)

- **Telemetry (item 3 / 1.2 / 1.5)** — needs `platform_events`. Proposed:
  `platform_events(id, tenant_id, user_id, kind, payload jsonb, created_at)`, FORCE RLS
  own-row on `app.user_id`; `record_platform_event(kind, payload)` `SECURITY DEFINER` that
  stamps `user_id` from `app.user_id` and enforces the per-user cap with the count
  **filtered to the caller** — `... WHERE user_id = app.user_id ...` inside the definer, not
  a bare `count(*)` — so one user's cap can never block another's inserts. Its own PR + §6 +
  the A-vs-B cross-user test you asked for. **This is the keystone: everything else in the
  run depends on it.**
- **Chip UI (PR3)** — the engine is done; wiring needs live reads. marketplace (exists),
  L&F-by-building-recent (small read), room->building for the schedule (small read; the
  join exists in `freeRooms`/`listRoomsWithCounts`) are clean; **rides is blocked on the
  campus-endpoint gap**. Also, with telemetry blocked, a shipped chip could not be measured
  (your stated goal), so wiring it now would likely be reworked. Deferred until the
  foundation lands.
- **"Anything missing?" card (1.4)** — needs the `timetable.view` count (`platform_events`)
  and the platform account (`is_platform`). Deferred.
- **Admin panel (1.5) + `/admin/feed-cards`** — needs `platform_events` + a page that does
  not exist. Deferred.
- **Block 2 ops** — the sweep additions land with the tables they purge; the report script
  and cap-trajectory check need `platform_events`. Deferred.

## Decisions you need to make (so the rest can proceed)

1. **`platform_events` design** — confirm the proposed shape + the per-user cap value and
   semantics. This unblocks all telemetry, 1.4, and 1.5.
2. **Platform account** — is it a new `users.is_platform` column, or should the feedback
   card message an `is_official` account, or a `platform_roles` holder? (You wrote
   `is_platform`; it does not exist yet.)
3. **rides "campus endpoint"** — add a structured field (e.g. `to_campus`/`from_campus`, or
   a campus place ref) to the rides model, or accept a text/coords heuristic? Without it,
   `rides-after-class` cannot honestly say "leaving campus".
4. **Admin page** — create `/u/[slug]/admin/feed-cards` fresh (it does not exist), or put
   the panel under the existing `/u/[slug]/admin/analytics`?

## Deploy steps (nothing runs against prod automatically)

```bash
pnpm db:migrate:all   # applies identity 0037 (timetable_chip_dismissals + definer)
```

No tenant flag flips, no LGU config change, demo untouched. The chip UI is not built yet,
so there is nothing user-visible to enable this run. When PR3 lands it ships behind a code
flag defaulted OFF; the enable diff will be one line in the LGU tenant config.

## The `is_platform` grant you asked for

`UPDATE users SET is_platform=true WHERE email='ahadnawaz585@gmail.com';` **will fail** —
there is no `is_platform` column. Decide #2 above first. If you choose to reuse the existing
official-account flag, the equivalent (Run 6) is
`pnpm official:promote -- --tenant <slug> --handle <your-handle>` (owner-run; the app cannot
set it). If you want a distinct platform account, it needs a new column + migration first.

## Per-signal "will it even fire on LGU?" probes (read-only; run against LGU yourself)

I cannot reach the LGU production DB from here (no prod access; "no production changes"), so
these are the read-only probes for you to run. They estimate the **supply** side (whether a
signal has anything to fire on); the exact "N users today" also depends on which sections
students view, which needs the view join once telemetry exists.

```sql
-- marketplace-course-match: active listings whose title carries a course-code-like token
SELECT count(*) FROM mkt_listings
WHERE tenant_id='lgu' AND status='active'
  AND title ~* '[A-Z]{2,4}[- ]?[0-9]{3,4}';

-- lostfound-building-match: active L&F items per building in the last 7 days
SELECT building_id, count(*) FROM lost_found_items
WHERE tenant_id='lgu' AND status='active' AND created_at > now() - interval '7 days'
GROUP BY building_id ORDER BY 2 DESC;

-- rides-after-class: ride offers per day (campus filter N/A until the gap is resolved)
SELECT date_trunc('day', depart_at) d, count(*) FROM ride_posts
WHERE tenant_id='lgu' AND status='active' AND kind='offer' AND depart_at > now()
GROUP BY 1 ORDER BY 1;

-- free-window-today: sections that have a >=2h gap between classes on some weekday
--   (approximate; the real per-student figure depends on the section in view)
-- run the engine's freeWindowToday over each section's entries, or inspect a few sections.
```

(Table names above are the working names; confirm against the live schema.)

## Browser checklist

Nothing user-visible shipped (engine + dismissal table only). Once PR3 lands: verify the
chip renders under a section's schedule for the top signal, is specific, dismisses, does not
reappear that day, shows nothing on a weekend / with no section in view, and does not block
LCP.

## Decisions log

See `docs/overnight/DECISIONS.md` (this run's section): the premise mismatch, schedule
source, module placement, the flag-vs-no-LGU-changes call, and the (untouched) ambassador
out-of-scope note.

## Unsure / risks

- The four foundational decisions above gate the rest of the run.
- `chipsForStudent` is keyed on the **section in view** (the chip renders under a schedule);
  there is no "my enrolled section" in the data model. If you want a user-wide chip
  independent of what they are viewing, that needs a schedule-resolution design.
- The signal engine is verified by unit tests only; its live reads (PR3) are not yet
  exercised against real data.

## Explicitly not done (as instructed)

No ambassador surface, role, badge, or page. No changes to communities/marketplace/rides/
L&F/messages beyond the reads the engine will need. No DB module enablement. Demo untouched.
