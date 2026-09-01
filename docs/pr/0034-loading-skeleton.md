# feat(web): loading skeleton for the timetable picker

Targets `main`. UI only; no schema or migration change.

## What

A calm, on-brand loading skeleton (a title placeholder and a card grid, with a
visually-hidden `role="status"` for screen readers) shown while the timetable
picker loads. The picker's reads (terms with sections + freshness) are the
heaviest on a tenant page, so it benefits most from instant feedback.

**Scoped to the timetable leaf route on purpose.** A route-group-wide
`loading.tsx` at `app/u/[slug]/` streams every tenant page, and streaming commits
an HTTP 200 before the render runs, turning a `notFound()` / `redirect()` into a
200 (breaking the soon-stub 404 and the bare-`/admin` redirect). The timetable
route never does either (the tenant is already resolved by the layout), so
streaming there is safe. The e2e for those status codes caught the broad version;
this is the scoped, correct one.

## Data & migration impact

None.

## Tests

- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (22)
  pass; format applied. The status-code e2e (`modules.spec.ts`,
  `admin-entry.spec.ts`) confirms the scoping keeps `notFound()` / `redirect()`
  intact.
- Verified the skeleton renders via a temporary delay on the page (removed before
  commit): a client navigation into `/u/lgu/timetable` shows the skeleton
  (`role="status"` "Loading" plus the pulsing placeholders) until the picker is
  ready.

## Verification steps

Navigate into the timetable from another tenant page on a slow connection: a
skeleton appears until the picker loads.

## Follow-ups

- The same leaf-scoped pattern can be added to other read-heavy pages (search,
  free-rooms) if wanted; avoid a `[slug]`-level boundary for the status-code
  reason above.
