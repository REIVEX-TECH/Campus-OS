# feat(web): the room directory shows a building only when it varies

Targets `main`. Presentation only.

## What

Every card in the room directory carried the same building name, because this
tenant's rooms all sit in one (the importer's placeholder, "Unassigned
Building"). Fifteen cards repeating one phrase is noise dressed as information.

The building line now appears only when there is more than one distinct building
in the list. A tenant with several buildings still sees them, which is when the
line actually helps; a tenant with one sees room names and their counts.

Written as a general rule rather than a check for the placeholder string: a value
identical on every row carries no information regardless of what it says, and
matching on the importer's wording would be tenant specific logic in shared code.

## Data & migration impact

None. The building is still read and still shown on the cards where it varies.

## Tests

- `pnpm turbo run typecheck lint build test --filter=web` and
  `pnpm --filter web test:e2e` (33) pass. The room directory spec asserts the
  cards and their filtering, which is unchanged.

## Verification steps

Open `/u/lgu/rooms`: cards read as room name plus counts. Add a room in a second
building and the building line returns on every card.

## Follow-ups

- The same reasoning would apply to a teacher's department if that is ever shown.
