# feat(web): empty states that read as deliberate

Targets `main`. Presentation only. No data or behaviour change.

## What

`EmptyState` was a sentence alone in a large card, which reads like a card that
failed to fill rather than a considered answer. It now takes an optional icon,
shown in a muted circle above the title, so the eye lands somewhere before the
sentence. The icon is decorative: the title already says what happened, so
announcing it again would only add noise.

Wired where an empty result is a normal outcome, each icon saying what is
missing rather than decorating generically:

- Search with no matches: a struck through magnifier.
- Free rooms with none free in the window: a closed door.
- Teacher and room directories before anything is published: people, a building.
- The timetable before a section is chosen: a calendar being searched, since that
  state is an instruction rather than a failure.

Padding also drops from `p-10` to `p-8` below `sm`, since a tenth of a phone
screen of blank card was a lot for one sentence.

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint build test --filter=web` and
  `pnpm --filter web test:e2e` (33) pass. The directory specs already assert the
  empty note, which is the behaviour that matters.
- Verified on a phone viewport: the search empty state shows the icon above the
  sentence with the tighter padding.

## Verification steps

Search for something with no matches, or open a tenant with nothing published:
the card carries an icon and reads as an answer rather than a gap.

## Follow-ups

- The remaining bare `EmptyState` calls (a course or section with no entries) are
  left plain on purpose: they sit under a heading that already names the thing,
  so an icon there would repeat it.
