# feat(web): line icons for modules, replacing emoji

Targets `main`. Swaps the emoji module icons for uniform lucide line icons across
the sidebar, the module hub, and the platform landing. No schema or migration
change.

## What

- **New dependency**: `lucide-react` (MIT), added to `apps/web`. It was not
  previously in the tree.
- `lib/modules.ts`: each module now names a line icon by a stable string key
  (`ModuleIconName` union: `calendar`, `door-open`, `search`, `shopping-bag`,
  `message-circle`, `package-search`, `car`, `map`) instead of an emoji glyph.
  The key is a string, so the data still crosses the server/client boundary.
- `_components/module-icon.tsx` (new): the single place that maps an icon name to
  a lucide component. Used by both the sidebar (client) and the hub (server), so
  every surface renders the same glyph at the same stroke weight. Icons inherit
  `currentColor` and the caller's size, so they theme in light and dark with no
  per-icon styling.
- Sidebar and hub render `<ModuleIcon>`; the hub and platform-landing feature
  cards wrap the glyph in a small rounded muted chip (Reddit/Linear style).
- Platform landing features render lucide directly (`CalendarDays`, `Search`,
  `Blocks`, `Unlock`) since they are a separate list, not part of `MODULES`.
- `.sidebar-icon` CSS switched from emoji font sizing to centring a fixed-size
  SVG (`.sidebar-icon-svg`, 1.15rem), so collapsed-rail icons stay centred.

## Data & migration impact

None.

## Tests

- No new tests: the module set and its labels are unchanged, and the existing
  `shell.spec` already asserts the sidebar nav and the active-page marker, which
  exercise the new icons. `timetable`, `section-views`, `seo`, `print`, and the
  rest of the suite pass unchanged.
- `pnpm turbo run typecheck lint build --filter=web` and
  `pnpm --filter web test:e2e` (26) pass; format applied.
- Verified in the browser, light and dark, desktop and mobile: the eight sidebar
  icons, the collapsed icons-only rail (centred), the hub cards, the mobile
  drawer (icons present in the DOM), and the platform landing features. Largest
  route First Load JS is 122 kB, under the 200 kB budget.

## Verification steps

Open `/u/lgu`: the sidebar and hub cards show line icons (calendar, door, search,
bag, message, package, car, map), uniform size and weight, that follow the theme.
Collapse the sidebar: the icons centre. Open `/`: the four feature cards show line
icons.

## Follow-ups

- Logo/branding is the next PR: favicon, apple-touch, PWA icons, and an in-app
  logo mark in the sidebar head, mobile topbar, platform header, and the loader.
