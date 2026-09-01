# feat(web): keep the admin area out of search indexes

Targets `main`. UI/SEO hygiene only; no schema or migration change.

## What

The admin login is publicly reachable (it is the entry point), so a crawler that
finds the URL could index it. An admin `layout.tsx` now sets
`robots: { index: false, follow: false }` for the whole admin subtree
(`/admin`, `/admin/login`, `/admin/rooms`, `/admin/analytics`). Public pages are
unaffected, and the sitemap already omits admin URLs; this closes the gap for a
crawler that discovers the URL some other way.

## Data & migration impact

None.

## Tests

- e2e (`admin-auth.spec.ts`): the publicly reachable login carries `noindex`.
- `pnpm turbo run typecheck lint build` and `pnpm --filter web test:e2e` (21)
  pass; format applied. Verified in a prod build that `/admin/login` emits
  `<meta name="robots" content="noindex, nofollow">` while the public landing
  emits none.

## Verification steps

`curl .../u/lgu/admin/login | grep robots` shows `noindex, nofollow`; the public
pages have no robots meta.

## Follow-ups

- None.
