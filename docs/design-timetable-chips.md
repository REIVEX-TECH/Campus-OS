# Timetable contextual chips — design

One small, specific chip under the timetable schedule, driven by a real signal for the
student's day. Dismissible per user per day. Empty state means no chip. Plus a one-time
"anything missing?" card after the third view, and telemetry into `platform_events`.

## Blocking finding (read first)

Three foundations this run's telemetry, feedback card, and admin panel are written on top
of **do not exist in the repository**. Confirmed by full-repo search (source, docs,
branches):

- **`platform_events` table + `record_platform_event` definer + per-user cap** — absent.
  The carryover ("confirm the cap counts the actor's own rows") has nothing to confirm; no
  such table or function exists. The only `count(*)` definer is `0011_activity_timing`
  (active-user analytics, unrelated).
- **`users.is_platform`** — absent. There is `is_official` (Run 6, the official-account
  badge) and `platform_roles` + `isPlatformAdmin()` (the platform-admin role), which are
  different concepts. The feedback card's "message the platform account" and the report's
  `UPDATE users SET is_platform=true` both assume a column that is not there.
- **`/u/[slug]/admin/feed-cards` page + "announcement metrics"** — absent. Admin pages are
  analytics, communities, join-policy, members, platform-access, roles, rooms, verification.

Building an entire events/telemetry subsystem (a `SECURITY DEFINER` writer, a per-user cap
whose semantics the carryover is explicitly worried about, RLS, retention), plus a
platform-account flag, plus an admin analytics page, all undesigned and overnight, is a
large §6-heavy surface and contradicts "keep it small." So this run **builds the parts
that do not depend on the missing foundation** and **defers the rest with a proposed
design** (below) for a waking decision. Nothing is invented on the false premise.

### Buildable now (this run)

1. **Signal engine** — pure, deterministic candidate functions + ranking, unit-tested
   against fixtures. Reads existing module data only. No writes, no `platform_events`.
2. **`timetable_chip_dismissals` table** — own-row RLS, FORCE, definer self-write, mirroring
   `card_dismissals` (0036) / `verify_prompt_dismissed` (0027).
3. **Chip UI** under the schedule + per-day dismissal. Ships behind a code flag that is
   **OFF by default (including LGU)** — see the flag decision below — so it is a no-op in
   production until enabled.

### Deferred (blocked on the missing foundation; proposed, not built)

- **Telemetry** (view/click/dismiss into `platform_events`) — needs the table + writer +
  cap. Proposed: `platform_events(id, tenant_id, user_id, kind, payload jsonb, created_at)`,
  FORCE RLS own-row on `app.user_id`; a `record_platform_event(kind, payload)` `SECURITY
DEFINER` that stamps `user_id` from `app.user_id` and enforces a per-user cap with the
  count **filtered to the caller** (`WHERE user_id = app.user_id` inside the definer, not a
  bare `count(*)` — this is the exact correctness the carryover asks for), so one user
  hitting their cap can never block another's inserts. This wants its own PR + §6 + the
  A-vs-B cross-user-cap test.
- **"Anything missing?" card (1.4)** — needs the `timetable.view` count (so `platform_events`)
  and the platform account (`is_platform`, or a chosen equivalent). Deferred with telemetry.
- **Admin panel (1.5) + `/admin/feed-cards`** — needs `platform_events` + a page that does
  not exist. Deferred.
- **Block 2 ops** (report script over `platform_events`, cap-trajectory check) — deferred.

## Data model (built this run)

`timetable_chip_dismissals(user_id uuid, tenant_id text, chip_kind text, dismissed_on date,
PRIMARY KEY(user_id, tenant_id, chip_kind, dismissed_on))`. ENABLE + FORCE RLS; own-row
policy keyed on `app.user_id` (read and write). Written through a definer that stamps
`user_id` from `app.user_id` — a self-write, so `app.user_id` is acceptable here (it is not
an authorization decision, per the rule; §6 note in the PR). `feedback-onetime` uses a
synthetic `chip_kind` with a sentinel `dismissed_on` so "ever" is one row. Nightly purge of
rows older than 30 days folds into the existing sweep (Block 2, deferred).

## Signals (built this run, pure functions over fetched data)

`chipsForStudent(ctx)` where `ctx = { tenantId, now, schedule }` and `schedule` is today's
classes for the section in view (see the schedule-source decision). Each signal is a pure
function returning a candidate or null:

- **marketplace-course-match**: course codes from today's class titles/`course.code`
  (`/^[A-Z]{2,4}[- ]?\d{3,4}$/` and the schema's `course.code`), tokenised
  case-insensitive match against active listing titles; top 1 with price, or null.
- **lostfound-building-match**: today's buildings (class rooms' buildings); count active
  L&F items in those buildings from the last 7 days; top building + count, or null if 0.
- **rides-after-class**: last class end today; count ride offers departing in
  `[end, end+3h]` with a campus endpoint; earliest departure + count, or null if < 2.
- **free-window-today**: largest gap between classes >= 2h ending before 18:00; the range,
  or null.

**Rank**: marketplace > lostfound-building > rides-after-class > free-window. Ties by
recency of the underlying row. Return the top **non-dismissed** candidate. No classes today
(weekend/holiday/unresolved) -> no chip.

Reads needed (small, indexed, one query each): active listings by tenant (exists); L&F
active-by-building-recent (small addition); ride offers by depart-window + campus endpoint
(small addition); room->building for the schedule (timetable `RoomRef` carries `name`, not
`building`, so a small resolve is needed). Profiling + the optional `chip_signal_cache`
(only if a signal exceeds 50ms on LGU-size data) is PR6, deferred with a note.

## Decisions (also logged in DECISIONS.md)

- **Schedule source.** The chip renders under a section's schedule, so "today's classes" =
  the section currently in view on the timetable page, passed into `chipsForStudent`. No
  section in view (bare picker) -> no schedule -> no chip. Avoids inventing a "my enrolled
  section" concept that does not exist.
- **Module placement.** The aggregator reads four modules, and modules may not import each
  other (CLAUDE.md 4), so `chipsForStudent` lives in the **app layer** (`apps/web/lib`).
  The dismissals table lives in **identity** (where `card_dismissals`/`verify_prompt` live).
  Small per-module read additions live in their own modules.
- **Flag vs "no LGU config changes".** The directive says "flag ON for LGU"; the standing
  rules say "no LGU config changes / no production changes." The guardrail wins: the chip
  ships behind a code flag **defaulted OFF**, and the report gives the exact one-line diff
  to enable it for LGU. Nothing changes in production until the human flips it.
- **No ambassador anything.** Out of scope, by explicit instruction.

## UI / mobile

An `ios-card`-vocabulary chip under the schedule: icon + one specific line + CTA + dismiss
X, ~56px tall on desktop, full-width on mobile. Copy names the real thing ("2 rides leaving
campus after 4pm"). Loads lazily after the schedule renders (does not block LCP); fails
silent on a signal error (logged server-side). Dismiss is per (user, chip_kind, today); the
next-ranked chip takes its place; all dismissed -> no chip.

## Verification

Unit tests: each signal against fixtures (fires / does not fire / boundary), ranking, and
"no classes -> no chip". Integration: dismissal persists across sessions and is own-row.
e2e (later PRs): no chip on weekend / no schedule; dismissal persists. The deferred
telemetry PR carries the cross-user cap test the carryover asks for.
