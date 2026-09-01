# fix(web): polish the 404 page and fix its theme on hydration

Targets `main`. UI only; no schema or migration change.

## What

The global 404 was bare and hardcoded English, and it ignored the user's theme.

- **Polish** (`app/not-found.tsx`): iOS-clean centred layout, a semantic `<h1>`,
  and a "Back to homepage" action. Strings now go through i18n (new
  `notFound.home`; the existing `notFound.title` / `notFound.body` were being
  bypassed by hardcoded text).
- **Theme fix** (`_components/apply-theme.tsx`): the root layout's pre-paint
  script sets `.dark` on `<html>`, but the not-found boundary re-renders `<html>`
  during hydration and dropped that class, so a 404 always rendered light. A tiny
  client component re-applies the resolved theme in a post-hydration `useEffect`
  (same logic as the layout script), so the 404 honours light + dark. Verified in
  a production build (the bug reproduced there, not just in dev).

## Data & migration impact

None.

## Tests

- e2e (`not-found.spec.ts`): an unknown tenant returns 404 and renders the `h1`
  and a home link.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (20)
  pass; format applied. Verified the 404 visually in light + dark on a prod
  build.

## Verification steps

Visit an unknown path (e.g. `/u/does-not-exist`): a clean 404 with a "Back to
homepage" link, correct in both themes.

## Follow-ups

- None.
