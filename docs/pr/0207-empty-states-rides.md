# docs+feat(rides): empty-state design pass and the rides empty state

Run 6, block B. A design pass on empty states (one page), then the first build it calls
for: the rides board's empty state. LGU and every other tenant get the improved rides
empty state; nothing else changes.

## What

- `docs/design-empty-states.md` — the one-page design: the shape (a first-run invitation
  with one primary CTA, plus a quieter "clear filters" variant), which module first
  (rides, with the reasons), and the metric (empty-board CTA conversion, read via the
  same click-through instrumentation as block D; a bounce guardrail for the filtered
  case).
- `apps/web/app/u/[slug]/rides/page.tsx` — replaces the lone-title empty state with the
  two-variant shape: a genuinely empty board shows an icon, a one-line value prop, and a
  single "Post a ride" CTA; a board emptied only by an active filter/search shows a
  "nothing matches" state with a "clear filters" link back and no create-CTA.
- `apps/web/messages/en.ts` — `rides.empty.heading`, `rides.empty.body`,
  `rides.empty.filtered`, `rides.empty.clearFilters` replace the single `rides.empty`
  (which had no other reference).

## Data & migration impact

No schema change. UI and copy only.

## Tests / verification

`turbo run typecheck` passes for web; the full web vitest suite (134) passes, including
the no-dash and i18n-plural checks. The new copy is dash-free. Manual check: the
unfiltered-empty rides board shows the invitation + CTA; adding a `?q=` or `?kind=` filter
that matches nothing shows the "clear filters" variant instead.

## Follow-ups

- The same shape adopts next, one module at a time, for marketplace, lost-and-found, and
  the communities feed (design doc names them; not built here).
- The metric is read once block D's click-through instrumentation lands and a week of
  data exists; no target is set before a baseline.
