# feat(web): Reddit-style app shell with a collapsible module sidebar

Targets `main`. PR 1 of the UI redesign (the frame). UI only; no schema or
migration change.

## What

Replaces the tenant top-nav shell with a persistent left module nav beside the
content, in a Reddit-style frame. This is the reviewable structure; page content
and the compactness pass follow in later PRs.

- **Sidebar** (`_components/sidebar.tsx`): the module nav from `lib/modules.ts` —
  Timetable / Free rooms / Search as live links with an active-state highlight
  (`usePathname` + `aria-current`), then the future modules as muted "coming
  soon" rows (non-links). Theme toggle in the footer. Grouping is by background
  and spacing, no divider lines.
- **Desktop collapse**: a toggle collapses the sidebar to icons-only (reclaiming
  width for the content), persisted in `localStorage` and applied pre-paint via
  `data-sidebar` on `<html>` (same no-flash pattern as the theme), so there is no
  layout shift and no hydration state.
- **Mobile drawer**: below `md` the sidebar becomes an off-canvas drawer behind a
  hamburger in a slim top bar. It is a real modal: `role="dialog"` +
  `aria-modal`, the rest of the shell is `inert` while it is open (so focus and
  the screen-reader cursor stay inside), the closed drawer is `visibility:hidden`
  (out of the tab order), and Escape / the backdrop / the X all close it and
  return focus to the hamburger. Ephemeral state (always closed on load), so the
  initial render is deterministic.
- **`PageShell`** (`_components/page-shell.tsx`): composes a page's center + an
  optional contextual right rail (sticky, `xl`-only, omitted when empty, never an
  inner scrollbar). The hub adopts it with an "About" rail to demonstrate all
  three columns; the rest adopt it in the rollout PR. Built so the future feed
  drops in as `center = feed`, `rail = trending`.
- **No inner scrollbars**: the sidebar is sticky and short, the content grows and
  the page scrolls. Verified that neither the sidebar nor the content has its own
  scrollbar.

The platform landing (`/`) keeps its own simpler header, unchanged.

## Data & migration impact

None.

## Tests

- e2e (`shell.spec.ts`): the Modules nav renders with the current page
  `aria-current="page"` and a labelled `aria-pressed` collapse toggle; and the
  mobile drawer is a focus-contained modal (`role="dialog"`, focus moves in,
  `main` is `inert`, Escape closes and returns focus to the hamburger).
- Updated `print.spec.ts` (the sidebar nav, not the old banner, is the chrome
  hidden in print) and `modules.spec.ts` (hub grid scoped to `main`, since the
  sidebar now also lists modules).
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (25)
  pass; format applied.
- An adversarial 3-lens review (a11y / responsive CSS / React) ran before merge;
  its findings were all fixed: closed-drawer focusability, modal focus
  containment + focus return, the desktop overflow-clip (now content-height, no
  inner scrollbar), collapsed-link accessible names, collapse-toggle state, the
  `-webkit-backdrop-filter` prefix, and reduced-motion coverage.
- Verified visually on a dev build: desktop expanded and collapsed (persisted
  across reload), light and dark, the `xl` About rail on the hub, and the mobile
  drawer (open, focus-in, backdrop, close) — with no inner scrollbars anywhere.

## Verification steps

Open a tenant page: the left sidebar shows the modules with the current one
active; the chevron collapses it to icons (kept after reload). Narrow to a phone:
the nav becomes a hamburger drawer. On the hub at a wide (`xl`) width, the About
rail is the third column.

## Follow-ups (next PRs in the sequence)

- PR 2: timetable form-left/results-right, sorted Semester (1st→8th) and
  searchable comboboxes, and removal of the grid's inner scroll.
- PR 3: compactness pass and rolling `PageShell` (with contextual rails) across
  the remaining tenant pages.
