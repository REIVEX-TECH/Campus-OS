# feat(web): a top bar over the module nav

Targets `main`. Chrome only: no schema change, no auth change, no new dependency.

## What

- **A persistent top bar** on every tenant page: the brand on the left, a rounded
  search in the middle, the account and the theme on the right. Sticky, full
  width, 3.25rem on a phone and 3.5rem above it.
- **The sidebar is navigation alone.** The brand and the account row moved up
  into the bar, so the university is named once rather than twice and the rail is
  the module list it was always meant to be. It still collapses to icons on
  desktop, persisted, and is still a drawer on a phone.
- **Search is wired to the real search.** Typing navigates, debounced, exactly as
  the old in page box did: on the search page it replaces `?q=` so results render
  without stacking history, anywhere else the first keystroke pushes to the
  search page so Back returns where you came from. Submitting goes at once. The
  in page box is gone, so there is one search input in the app.
- **The account corner** is the avatar and handle with a small menu (your
  account, sign out), or a sign in control that still goes straight to Google in
  one click when a provider is configured and stays a plain link to the sign in
  page when one is not. Escape and a click outside close the menu; focus returns
  to the button.
- **Mobile**: hamburger, mark, name, then a search icon that takes the bar's
  width when opened and hands focus to the input; Escape or the X closes it. The
  drawer opens below the bar rather than over it.

## The two things flagged as looking poor

- **The About card** was a heading and the SEO sentence, which read as a stub. It
  now leads with the mark and the university name, keeps the description, and
  lists the live modules as quiet pills, ending with the one thing a reader
  wants to know: everything here is open to read without an account.
- **The account in dark** read badly because it sat in the sidebar foot as bare
  muted text. In the bar it is a filled pill with the avatar and the handle at
  `text-foreground`, so the name is a name rather than a dim label.

## How the two halves share one drawer

The hamburger is in the bar, the drawer is the sidebar, and the page sits between
them in the DOM, so neither can own the state. `ChromeProvider` is the small
piece that joins them: it holds whether the drawer is open, makes the rest of the
chrome `inert` while it is, closes on Escape, and returns focus to the hamburger.

## Data & migration impact

No schema change. `search-box.tsx` and `sidebar-account.tsx` are deleted; their
jobs moved into the bar.

## Tests

- e2e (4 new, 55 total): the bar renders on four different tenant pages, is still
  in view after scrolling, and its brand, search and account sit left to right in
  that order; typing in it reaches the real search results and leaves one search
  input in the app; the sidebar carries neither the brand nor the account; and on
  a 375px phone the search icon expands and focuses, the hamburger opens a modal
  drawer that Escape closes, with no horizontal scroll.
- Two existing specs were updated, not weakened: the teacher directory filter is
  matched exactly now that the bar's label starts the same way, and the two sign
  in tests point at the bar instead of the sidebar foot.
- `pnpm turbo run typecheck lint test` (16 + 7), `pnpm --filter web build` and
  `pnpm --filter web test:e2e` (55) pass.

## Verification steps

Verified in a real browser against the production build (`next start`), not dev:

1. `/u/lgu/timetable` at 1440px: the bar measures brand at x=12, search centred
   at x=230 (528px wide, a real `input[type=search]`), the account at x=766;
   `position: sticky`, `top: 0`, 52px tall, zero horizontal overflow.
2. Typed `akhtar` in the bar and pressed Enter: landed on
   `/u/lgu/search?q=akhtar` with the Rabia Akhtar result, zero in page search
   inputs.
3. Dark: the rail clears the bar (`top: 68px`), the About card shows the mark,
   name, description and module pills.
4. 375px: hamburger, mark, name, search icon, theme, account all visible with
   zero overflow; the search icon expands to a 311px focused input with the
   brand stepping aside; the drawer opens at `top: 52px` with `role="dialog"`,
   the bar and main `inert`, ten nav items, and no brand or account inside it.
5. `curl` of the production server shows `id="app-topbar"` in the SSR HTML.

## Follow-ups

- The signed in account menu was exercised by unit level reasoning and the e2e
  signed out path only: a real Google session cannot be created in this
  environment, so the avatar, handle and dropdown want one look on the
  deployment.
- `--topbar-h` is a plain token; if the bar ever grows a second row, the rail
  offset and the drawer inset follow it automatically.
