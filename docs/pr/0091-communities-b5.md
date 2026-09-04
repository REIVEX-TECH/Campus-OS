# feat(communities): b5, profiles and private lists

## What

A public profile per handle at `/people/{handle}`: what a person posted and
said under that name, a modest karma when the tenant shows it, and Block
from the page; the person's own private lists: saved comments beside saved
posts, hidden posts with unhide, and "Posted anonymously" on their own
profile only; handles on cards and comments link to profiles; the account
page links to all of it.

## Why

A handle that goes nowhere is a label; a handle that opens a page is a
person. The design kept karma modest and behind a tenant toggle, and kept
the anonymous list private, and this PR does both by construction rather
than by care.

## How

### Module

- `src/profiles.ts`: `profileByHandle` (case insensitive, over
  `public_profiles`), `karmaOf` (score summed over live posts and comments
  keyed on the public author column), `commentsByAuthor` (signed comments in
  public communities with the post and community for context; a removed
  comment keeps its place without its words), `isBlocked`.
- `saved.ts`: `listSavedComments`, `listHiddenPosts` (own rows; a hidden
  post reads back through the view like any other).
- Everything a profile shows is keyed on `public_author_id`, which is null
  for anonymous items, so nothing anonymous can reach a profile whatever a
  caller passes; `myAnonymousPosts` (from A3) serves the private tab as the
  person themselves.

### Web

- `/people/[handle]`: avatar, handle, karma when `karmaVisible`, Block for a
  signed in viewer who is not the person, tabs Posts and Comments, and for
  the person themselves a third tab, Posted anonymously, with a note that
  only they see it. Unknown handles are 404.
- `/saved` gains a Comments tab; `/hidden` lists what a person hid with
  Unhide on each line.
- Author handles on post cards and comments link to profiles.
- The account page gains a Communities card linking to the profile, saved,
  hidden, blocked people and notifications, when the module is on.
- Strings: `profile.*`, `saved.*`, `hidden.*`, `account.communities.*`.

No schema change.

## Security

Profiles read through the same views as everything else and filter on the
generated public author column; the karma sum uses the same column, so an
anonymous post's votes never accrue to a name. The private anonymous tab
renders only when the viewer is the person (compared by user id on the
server) and reads through `is_own`. Blocked state is the viewer's own rows.
The RLS invariant is unchanged.

## Tests

- Integration (one new case): an unknown handle is null and a known one
  resolves regardless of case; the profile's posts and comments hold the
  signed items only; karma counts the signed post and comment and not the
  anonymous post; the anonymous list is the author's alone; blocked state
  shows to the blocker only; saved comments and hidden posts are the
  person's own lists, hiding drops a post from their feed and unhiding
  brings it back. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 31 passed, 1
  skipped (the column privilege test, split database only). `pnpm --filter
web build` clean.
- e2e (one new case): an unknown handle is 404 and `/hidden` sends a
  stranger to sign in. `pnpm --filter web test:e2e` against a production build:
  1 failed 82 passed on the first run, 83 passed on the second.
- Browser (local dev server, signed in): the handle on a card links to
  `/people/Eastern_Eagle_1899`, which shows six posts and the tabs Posts,
  Comments and, as the person themselves, Posted anonymously (empty, with no
  anonymous posts to show); Comments lists two, one as "[removed by
  moderators]"; Hide on a card puts the post under Hidden posts with Unhide,
  which empties the list; Saved opens on its Comments tab; the account page
  links to the profile, saved, hidden, blocked people and notifications.

## Verification steps

Click a handle on any card: the profile opens with their posts; switch to
Comments; open your own profile from the account page and see Posted
anonymously; hide a post from a card and find it under Hidden; unhide it;
save a comment and find it under Saved, Comments.

## Migration notes

No schema change.

## Breaking changes

None. `CommentThread` takes a `base` prop for the profile links.

## Follow-ups

- Karma is a sum of scores; a decay or a cap can come when a tenant asks.
- Profiles show up to twenty posts and thirty comments without paging;
  cursors can follow the feed's pattern when a profile outgrows that.
