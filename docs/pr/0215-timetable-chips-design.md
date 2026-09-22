# docs(engagement): design pass for timetable contextual chips

Design-first pass for the timetable contextual chips run (PR 1 of the sequence), before
any code. Docs only.

## What

- `docs/design-timetable-chips.md` — the plan: data model, the four signals, ranking,
  per-user-per-day dismissal, telemetry, empty-state, and mobile layout.
- `docs/overnight/DECISIONS.md` — the run's decisions.

## The finding that shapes the run (please read)

The run's telemetry (item 3 / 1.2 / 1.5), the "anything missing?" card (1.4), and the
carryover ("confirm the `record_platform_event` cap") are written on top of infrastructure
that **does not exist** in the repo, confirmed by a full search of source, docs, and
branches:

- **`platform_events` + `record_platform_event` + per-user cap** — absent (nothing to
  confirm or test for the carryover).
- **`users.is_platform`** — absent (`is_official` and `platform_roles`/`isPlatformAdmin`
  exist, different concepts).
- **`/u/[slug]/admin/feed-cards` + "announcement metrics"** — absent.

Rather than invent an events subsystem (a `SECURITY DEFINER` writer whose cap semantics the
carryover itself flags as delicate), a platform-account flag, and an admin analytics page
overnight and undesigned — a large §6 surface, against "keep it small" — this run builds
what does not depend on the missing foundation and defers the rest with a concrete proposed
design in the design doc:

- **Built:** signal engine (pure + fixture-tested), `timetable_chip_dismissals` table, chip
  UI (behind a flag defaulted OFF, so a no-op in production until enabled).
- **Deferred (proposed, not built):** telemetry into `platform_events` (incl. the cap done
  the correct per-caller way), the feedback-onetime card, the admin panel, Block 2 ops.

## Key decisions (in DECISIONS.md)

Schedule source = the section in view; `chipsForStudent` lives in the app layer (modules
cannot import each other); the chip flag ships OFF (the "ON for LGU" ask conflicts with "no
LGU config changes" — the guardrail wins, enable diff in the report); no ambassador surface.

## Data & migration impact

No schema change. Docs only.

## Tests / verification

`prettier --check` passes. Build PRs follow (SHA per PR).
