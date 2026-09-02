# feat(web): consistent logo, crisp collapsed rail, tighter mobile

Targets `main`. Shell and responsive polish: a theme-consistent in-app logo, a
tidier collapsed sidebar, clearly disabled coming-soon modules, and a denser
mobile layout. No schema or migration change.

## What

- **Logo consistency** (`_components/logo-mark.tsx`, `scripts/generate-brand-assets.mjs`):
  the in-app mark is now the filled disc in both themes, one silhouette that never
  appears to change between light and dark. Because the disc's mark is a
  transparent knockout, it tone-adjusts to the surface on its own (a light mark on
  light, a dark mark on dark), which is the "same silhouette, tone-adjusted" the
  brief asked for, and it matches the favicon and app icons. `logo-mark.png` is now
  the disc; the separate light variant and the open-mark generation are dropped
  (`assets/photos/logo.png` stays as an archived alternate).
- **Collapsed rail header** (`sidebar.tsx`, `globals.css`): the collapse control is
  now a hamburger (matching the mobile menu and the Reddit reference) instead of a
  lone chevron, and the collapsed header centres the logo above the hamburger with
  even spacing and top padding, so it reads as a tidy app bar rather than two
  stray glyphs.
- **Coming-soon modules** (`globals.css`): they were already shown on mobile (the
  hub grid and the sidebar drawer both render every module); this makes their
  disabled state unmistakable by greying the soon rows (`opacity: 0.6`), the same
  in both themes and both viewports.
- **Mobile compactness** (`globals.css`, `u/[slug]/page.tsx`): content padding
  `1rem -> 0.75rem`, the hub display heading `text-4xl -> text-2xl` on phones
  (full size from `sm`), and tighter hub grid gaps and card padding on small
  screens. Desktop spacing is unchanged.

## Data & migration impact

None. `logo-mark.png` is regenerated (now the disc); `logo-mark-light.png` is
removed.

## Tests

- `landing.spec.ts` updated: the removed light variant is dropped from the served
  brand-asset check; the disc `logo-mark.png` is still asserted.
- `pnpm turbo run typecheck lint build --filter=web` and
  `pnpm --filter web test:e2e` (26) pass; format applied.
- Verified in the browser, light and dark, desktop and mobile: the disc reads on
  both themes (mark tone-adjusts), the collapsed rail shows the logo above the
  hamburger, soon modules are greyed with their tag, and the mobile hub is denser
  (the heading now fits one line, cards ~124px).

## Verification steps

Collapse the sidebar: the header is the logo above a hamburger. Toggle the theme:
the logo keeps one silhouette, its mark following the background. On a phone, open
`/u/lgu`: the heading is compact and every module (including the greyed
coming-soon ones) is visible.

## Follow-ups

- Picker fixes (Section dark-mode select, skeleton-on-navigation, progressive
  enable) and the timetable time filter follow in their own PRs.
