# feat(identity): one click sign in from anywhere, and a page that explains itself

Targets `main`. Sign in UX only. Gates nothing; changes no auth or tenancy
behaviour on the server.

## What

- **One click from the sidebar.** The account row at the foot of the sidebar,
  which is on every page, now signs you in directly when a provider is
  configured. Underneath it is still a link to `/signin`: a middle click, a
  modifier click, or a browser without script all reach the page as before, and
  a deployment with no provider gets the plain link. While Google is open the row
  shows a spinner and "Opening Google"; if the window is closed or blocked it
  reads "Try again", with the full sentence in the tooltip and a status region.
  The drawer stays open on a phone so the reader can see that anything happened.
- **The sign in page** is no longer one button on an empty card. It shows the
  account card the account page renders once you are in, filled with a fixed,
  labelled example (`Amber_Cascade_4821` and its avatar, drawn from a public seed
  that belongs to nobody), the accent button and one line about the Google
  window. Below it, three facts a person wants answered before pressing a Google
  button: the email is never shown publicly, the handle is not your name, and
  the change and reservation rules with the day counts interpolated from the
  module's constants, never typed. Then where the handle will be used, listing
  the planned modules flagged `needsIdentity` and saying plainly they are planned,
  not built. Then a real way back to the timetable.
- **Nothing is overstated.** Nothing on this deployment is gated, and the page
  says so twice. Every sentence was checked against what the code does.

## Two bugs found on the way, fixed here with failing tests first

- **Re rolled avatars never drew.** `rerollAvatar` wrote seeds shaped
  `userId:timestamp`; the avatar route accepts only letters, digits, `_`, `.`
  and `-`, so every re rolled avatar 404ed to a bare backdrop. The seed is now
  built by a pure `nextAvatarSeed`, the route's pattern is exported as
  `AVATAR_SEED_PATTERN`, and a contract test in the web app pins the two together.
- **The dark mode accent never applied.** `.dark [data-tenant]` was meant to
  swap `--primary` for a lightened tenant colour, but `accentStyle` set
  `--primary` as an inline style on the same element, and inline always wins.
  Every `text-primary` link in dark mode was the raw LGU green on near black:
  2.45:1, a WCAG failure the lightening code was written to prevent. The inline
  style now carries only tenant prefixed inputs and the stylesheet chooses per
  theme. Dark mode links are now 10.64:1. This is visible on every accent
  element in dark mode, which is what the design system always intended.

## Judgement calls worth naming

- The sidebar row is a **link that intercepts**, not a button. It keeps the
  existing e2e selector valid, keeps "open in new tab" working, gives assistive
  tech an honest name, and degrades to the page without script.
- `account.emailNote` still says "Only you and moderators can see this." A
  proposal to change it to "not shown to anyone else" was declined: no moderator
  role exists yet, but the design doc plans one with exactly that access, and a
  disclosure that becomes true is better than a promise that becomes false.
- The tenant logo in `tenants/lgu/tenant.config.ts` points at a file that does
  not exist and is used nowhere, so the page uses the display name and accent
  rather than an image that would 404.

## Data & migration impact

No schema change. One workspace dependency declared that the web app was already
importing through hoisting (`@campusos/module-identity`); three lockfile lines.

## Tests

- Unit: `accentStyle` emits raw inputs and never the resolved token, and lightens
  enough to read (2 new); `nextAvatarSeed` is drawable, changes over time, and is
  scoped to the user (3 new in the module, 3 contract tests in the web app).
- Integration: the re rolled seed must match the route's shape (1 assertion added).
- e2e (1 new, 44 total): the sidebar row is a real link when no provider is
  configured; the page's example identity, three facts and back link render with
  no provider (4 assertions added to the existing test).
- `pnpm turbo run typecheck lint test` and `pnpm --filter web build` pass;
  `pnpm --filter web test:e2e` 44 passed.

## Verification steps

Locally the provider path was exercised with a throwaway config in the git
ignored `.env.local`: the click intercepts (no navigation), the SDK loads from
the CDN, `initializeApp` receives the server passed config, and the blocked popup
lands in "Try again". The sandbox blocks popups, so Google's own window and the
token exchange were not driven here; that code is a verbatim move of what was
already confirmed working in production. On a deployment with the provider:

1. From any page, click "Sign in" in the sidebar. Google opens at once.
2. Complete it. The row becomes your handle without a page change.
3. Visit `/u/lgu/signin` signed out, in both themes and at 375px. No horizontal
   scroll; the example avatar draws; "Back to the timetable" is legible in dark.
4. On the account page, press "New avatar". The picture changes.

## Follow-ups

- `buttonVariants` bakes in `whitespace-nowrap`; a long locale label could not
  wrap inside the full width button at 375px. Check before adding a second locale.
- `account.handleHint` hardcodes "30 days" and should interpolate
  `HANDLE_CHANGE_COOLDOWN_DAYS`. `account.intro` says "your university email"
  though no domain is enforced yet. `signin.signedInAs` and `signin.handleNote`
  appear to have no callers.
- `tenants/lgu/tenant.config.ts` `logoPath` points at a missing file.
- The identity integration suite still needs a role split database, which only
  CI has.
