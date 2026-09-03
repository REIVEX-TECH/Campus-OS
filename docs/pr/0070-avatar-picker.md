# feat(identity): choose an avatar instead of being handed one

Targets `main`. No schema change. The avatar was already a seed on the user row;
what changes is who picks it.

## What

- **The avatar on the account page is a button.** Pressing it opens a modal with
  a grid of twelve illustrated options, drawn from the library already in use.
  Picking one previews it at the top of the sheet; Save applies it. Cancel,
  Escape, the X and the backdrop all close without changing anything.
- **Show more** brings the next twelve rather than applying something random, so
  a reader browses instead of rolling dice. Options are numbered and stable: the
  same number always draws the same picture, so it is possible to shuffle past
  one and come back to it. Paging wraps, so it never dead ends.
- **The plain "New avatar" re roll is gone.** It was the only way to change an
  avatar and it gave no say in the result.
- **Keyboard and screen reader**: the grid is a radio group with a roving
  tabindex, so arrows move between options and the selection is announced. The
  page behind goes `inert`, focus lands on the first option, Escape closes, and
  focus returns to the avatar button that opened it.

## Only a number crosses the wire

The browser sends an option number, never a seed. The server builds the seed
from that number and the caller's own id, so a saved avatar is always one of that
person's own options: no browser can name a picture belonging to someone else or
invent a seed of its own. The number is bounded to the options that exist, and
the shape is checked before anything is written.

## Two bugs found while verifying, not by reading

Both were caught driving the real thing in a browser, and neither would have
shown up in a screenshot of the modal.

- **The modal was inert.** The picker is opened from a button inside `<main>`,
  and the modal marks `<main>` inert so focus cannot wander behind it. Rendered
  where it was written, the dialog was inside that subtree: it painted correctly
  and was completely unusable, by mouse and keyboard alike. It now renders
  through a portal to `<body>`, which is what makes the inert boundary mean
  anything.
- **Focus never entered the dialog.** Marking a subtree inert blurs whatever was
  focused inside it, and the browser settles that after the current task, so a
  `requestAnimationFrame` focus landed first and was undone. Focus now moves on a
  macrotask, and to the first option rather than the dialog, which is where a
  reader wants to be anyway.

## A correction to PR 77

That PR's description said every mutation checks `Origin` and is rate limited.
That was not true of `/api/account/handle`, `/api/account/avatar` and
`/api/account/recents`, which had neither. `SameSite=Lax` already stops the
session cookie riding along on a cross site POST, so the exposure was small, but
the claim was wrong and the gap was real. All three are checked now, and an e2e
test pins it.

## Data & migration impact

No schema change. `nextAvatarSeed` becomes `avatarOptionSeed` and `rerollAvatar`
becomes `chooseAvatar`; existing seeds keep working, and a user who has never
opened the picker keeps the avatar they have.

## Tests

- Unit: option seeds are always something the avatar route will draw, one
  picture per option, stable, and scoped to the user; the option range accepts
  only whole numbers inside it and refuses `-1`, `1.5`, `NaN`, `Infinity` and one
  past the end; a page is a full grid of distinct options and wraps in both
  directions.
- Integration: choosing writes the chosen seed and leaves the handle alone.
- e2e (3 new, 57 total): both halves of the avatar endpoint require a session; a
  malformed or out of range option is refused; and the account mutations refuse a
  cross site POST.
- `pnpm turbo run typecheck lint test` (23 tasks), `pnpm --filter web build` and
  `pnpm --filter web test:e2e` (57) pass.

## Verification steps

Driven in a real browser against a minted local session, signed in as
`Mossy_Quail_6527`:

1. `/u/lgu/account`: the avatar is a button labelled "Change your avatar" and the
   old "New avatar" is gone.
2. Opening it renders a dialog outside `<main>`, `<main>` inert, the dialog not
   inert, twelve options in the accessibility tree, focus on "Avatar 1", Save
   disabled.
3. Arrow keys move the selection (Avatar 1 to Avatar 2, `aria-checked` follows)
   and the preview follows to `...671.3`; Save enables.
4. Saving closes the dialog, drops `inert`, and both the account avatar and the
   one in the top bar become `...671.3`. It survives a full reload, so it is in
   the database and not just the page.
5. Show more replaces the grid with options 12 to 23, zero overlap with the page
   before it.
6. Dark reads cleanly; at 375px it is a bottom sheet with a four column grid and
   no horizontal overflow.

## Follow-ups

- The top bar avatar opens the account menu rather than the picker, which is
  where the menu's "Your account" leads anyway; wiring the modal into the bar
  would put the whole grid in the bundle of every page for a second way to reach
  the same thing.
- Options are a deterministic function of the user id, so two people never share
  a page of choices, but nothing stops two people choosing pictures that look
  alike. That is the same as it was before, and handles remain the identity.
