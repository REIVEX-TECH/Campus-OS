# feat(web): themed error boundary

Targets `main`. UI only; no schema or migration change.

## What

There was no error boundary, so a runtime error fell to Next's bare fallback.

- `app/error.tsx` (client): a clean, themed "Something went wrong" page with a
  "Try again" action (`reset()`) and a link home. Renders inside the root layout,
  so it is full-width, iOS-clean, and correct in light + dark (reusing the 404's
  post-hydration theme re-apply). Strings go through i18n (new `error.*`).
- The error is not logged client-side (Next already logs it server-side; no
  client logging of error details).

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (20)
  pass; format applied.
- Verified visually in a production build via a temporary throwing route (removed
  before commit): the boundary renders correctly in light + dark, and "Try
  again" / "Back to homepage" work. There is no crashing route in the app, so
  this is not covered by an automated e2e.

## Verification steps

Trigger a render error in any route; the boundary shows "Something went wrong"
with "Try again" and "Back to homepage", correct in both themes.

## Follow-ups

- A `global-error.tsx` (root-layout crash) could be added later; it is a rarer,
  harder-to-test boundary and is intentionally out of scope here.
