# fix(web): pointer cursors, search out of the sidebar, and no browser history in the search box

Targets `main`. Three small fixes. No schema change, no new dependency.

## 1. Nothing looked clickable

Tailwind v4's preflight no longer gives `button` a pointer cursor, so **every
button in the app** was showing the default arrow: the avatars the report
mentioned, but equally the theme toggle, the hamburger, the collapse control,
the picker's options and every form button. Rather than adding `cursor-pointer`
to the two controls that were noticed, the rule goes back once at the root, for
buttons, `role="button"`, `role="radio"`, `role="menuitem"`, `label[for]` and
`summary`. Anything disabled says so with `not-allowed` instead, and the
non-interactive "Coming soon" rows keep the arrow they should have.

Audited alongside it: links already carry a pointer from the browser, so the
brand, the nav items and the sign in control were never affected.

## 2. A hover state on the two avatars

An avatar is a picture, so it has no affordance of its own. Hovering the one on
the account page now rings it in the tenant accent with a small gap, and dims it
very slightly; the account pill in the top bar takes a thinner ring of the same
colour, because it is a pill rather than a circle. Both settle in 150ms and stop
moving entirely under `prefers-reduced-motion`.

## 3. Search leaves the sidebar

Search is in the top bar on every page, so the sidebar row was a second way to
reach the same page. `ModuleCard` gains `hideFromNav`, and the shell filters on
it when it builds the sidebar items. The hub still shows its Search card and the
About rail still lists Search as a live module: the module did not go away, it
just stopped taking a row in the navigation.

## 4. The search box was offering browser history

The input was `name="q"` with the browser's autocomplete left on, so Chrome
filed and then offered its own form history: URLs typed into other sites,
dropped over the app's own search. The `name` is gone, which is what the browser
keys that history on and which nothing needed, because submitting is handled in
script rather than by serialising the form. `autoComplete`, `autoCorrect` and
`autoCapitalize` are off, `spellCheck` is false, and `data-1p-ignore`,
`data-lpignore` and `data-form-type="other"` ask the common password managers to
leave it alone too.

## Data & migration impact

No schema change.

## Tests

- The shell e2e asserted the sidebar offered a Search link; it now asserts the
  opposite, with the reason. Nothing was weakened to make it pass.
- `pnpm turbo run typecheck lint test` (23 tasks), `pnpm --filter web build` and
  `pnpm --filter web test:e2e` (57) pass.

## Verification steps

Measured in a browser on the production build, signed in:

1. Computed cursors: account page avatar `pointer`, top bar account pill
   `pointer`, theme toggle `pointer`, hamburger `pointer`, sidebar collapse
   `pointer`, a disabled Save `not-allowed`, a "Coming soon" row `default`, and
   the search input `text`.
2. Hovering the account page avatar draws the accent ring, screenshotted.
3. The sidebar lists Timetable, Free rooms, Teachers and Rooms with no Search,
   and `.app-sidebar a[href$="/search"]` counts zero.
4. The search input renders with `autocomplete="off"`, no `name`,
   `spellcheck="false"`, `autocorrect="off"`, `autocapitalize="off"`,
   `data-1p-ignore` and `data-lpignore`.

## Follow-ups

- **Dev only, pre-existing, worth a look.** In `next dev` the top bar's search
  never appears: its Suspense boundary stays postponed (`<!--$~-->`) and the
  fallback is what renders, with no error on the server or the client. It
  resolves correctly under `next build` plus `next start`, which is what the e2e
  suite exercises, so users are unaffected. It reproduces on `main` with this
  branch's changes reverted, so it is not from this work; it is the
  `useSearchParams` boundary in `TopSearch` and it makes the bar hard to work on
  locally.
- Suppressing autofill is a request to the browser, not a guarantee: a user with
  an aggressive extension may still see its suggestions.
