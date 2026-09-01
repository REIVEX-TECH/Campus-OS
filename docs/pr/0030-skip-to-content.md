# feat(web): skip-to-content link

Targets `main`. UI/accessibility only; no schema or migration change.

## What

A "Skip to content" link so keyboard and screen-reader users can jump past the
header nav straight to the page content (WCAG 2.4.1 Bypass Blocks).

- `_components/skip-link.tsx`: the first focusable element on the page, visually
  hidden (`sr-only`) until focused, then revealed top-left with a focus ring. It
  targets `#main`.
- Wired into the tenant `AppShell` and the platform landing; both `<main>`
  elements now carry `id="main"` and `tabIndex={-1}` so the link has a focus
  target. String via i18n (`a11y.skipToContent`).

## Data & migration impact

None.

## Tests

- e2e (`landing.spec.ts`): the skip link is the first tab stop, targets `#main`,
  and the `main#main` landmark exists.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (21)
  pass; format applied. Verified visually in a prod build: the link is hidden
  until focused, then appears with a focus ring.

## Verification steps

Load any tenant page or the platform landing and press Tab: "Skip to content"
appears top-left; activating it moves focus to the main content.

## Follow-ups

- None.
