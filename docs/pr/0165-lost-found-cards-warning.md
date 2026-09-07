# feat(lost-found): warn against posting a real card or ID photo

The "Cards and IDs" category invites exactly the photo that should not be posted:
a full card or ID showing its number and personal details. When that category is
chosen on the post form, a caution now appears asking the poster to describe the
item instead and let the owner claim it privately.

## What

- A `role="note"` caution below the category select, shown only when the category
  is `cards-and-ids`. One i18n string (`lostFound.form.cardsWarning`), wired
  through `LostFoundFormLabels` and the post page. Amber, AA-contrast in light and
  dark, no dashes.

## Data & migration impact

No schema change.

## Tests

Typecheck, lint, format, no-dash guard green. This is a conditional string in a
client form; no new unit test.

## Verification

On `/u/lgu/lost-found/post`, choose "Cards and IDs": the caution appears; choose
another category: it is gone.

## Follow-ups

None.
