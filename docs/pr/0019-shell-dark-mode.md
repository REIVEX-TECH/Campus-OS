# feat(web): full-width app shell + dark mode

Targets `main`. UI foundation for the overnight batch (everything else builds on
it). No schema, migration, or query change.

## What

- **Dark mode.** LIGHT stays the `:root` default; DARK is `.dark` on `<html>`. A
  tiny inline layout script resolves the theme before first paint (stored choice,
  else `prefers-color-scheme`) so there is no flash; a header `ThemeToggle` flips
  and persists it (`localStorage`), with the icon driven by the `dark:` variant
  (no hydration state). `color-scheme` is set per theme. The forced-light class is
  gone.
- **Theme-aware tenant accent.** The raw accent (LGU green `#0b5d3b`) fails AA as
  link text on the near-black page, so `lib/branding.ts` also emits a lightened
  variant (`#aac6ba` for LGU) applied via `.dark [data-tenant]`. Every dark
  pairing clears AA (foreground 18.96, muted 7.22 to 7.98, accent 9.81 to 10.84).
- **Full-width shell.** New `AppShell` (sticky frosted header with tenant name,
  nav, and the toggle; no divider line) wraps the tenant layout over a full-width
  `<main>` capped at `max-w-[120rem]`. The `max-w-3xl` centred column is removed
  from every tenant page (timetable, section, teacher, room, admin rooms, tenant
  home); the picker card keeps a narrow internal max-width, the tenant home stays
  a centred hero.

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint format:check test build` (22 tasks) and
  `pnpm --filter web test:e2e` (11) pass; existing specs are theme/shell-agnostic.
- Verified live on a section page in both themes: full-width shell, header +
  toggle, near-black dark palette with legible lightened-green links, instant
  toggle, correct light mode.

## Verification steps

Open any tenant page; toggle light/dark in the header; confirm no flash on
reload, `prefers-color-scheme` respected when no choice is stored, and full-width
layout in both themes.

## Follow-ups

- Platform landing (`app/page.tsx`) full-width redesign lands with the landing PR.
- Nav grows (Free rooms, Search) as those features land.
