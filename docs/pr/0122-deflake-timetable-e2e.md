# test(web): deflake the timetable e2e picker interactions

Two timetable specs flaked on cold CI runners and cost repeated reruns. Both
raced the picker's hydration / soft-navigation; fixed with real-condition waits,
no `waitForTimeout` sleeps and no weakened assertions.

## Changes (`apps/web/e2e/timetable.spec.ts`)

- **"remembers what you looked at"**: replaced `page.waitForURL(predicate)` after
  clicking a recents link with `expect(page).toHaveURL(/section=/)` plus an exact
  check of the `section` param. A recents link is a soft (client) navigation,
  which never fires the `load` event `waitForURL` waits for by default - the flake.
  `toHaveURL` polls `page.url()` and is robust to soft and full navigations alike.
- **"semester combobox is searchable and keyboard-operable"**: wait for the
  combobox to be `toBeFocused()` after the click, before pressing Arrow/Enter. On
  a cold runner the click can land before the control is hydrated, so the keys go
  nowhere and the picker never navigates; focus is the ready signal.

## Data & migration impact

No schema change. Test-only.

## Tests

The change is to the e2e specs themselves. Verified `tsc`, eslint, and
`playwright test --list` parse the file; the e2e job runs them in CI.

```bash
pnpm -C apps/web exec playwright test e2e/timetable.spec.ts
```

## Follow-ups

- Retire ADMIN_SECRET (next).
