# test(web): deflake the recents e2e by retrying the hydration-raced click

The timetable "remembers what you looked at, even signed out" spec still flaked
after the earlier deflake (#0122): it failed on a cold runner at the URL
assertion, not the click, so the recents link was found and clicked but the
navigation never fired.

Root cause: the recents panel is a `'use client'` component that renders nothing
on the server when signed out and only paints its `<Link>`s after a post-mount
`useEffect` reads `localStorage`. Clicking such a Link before its client router
handler is attached leaves the URL on the bare picker — the soft navigation
never happens, and waiting longer on that one click cannot recover it. #0122
fixed the wait (`toHaveURL` polling), which was necessary but not the cause.

## Change (`apps/web/e2e/timetable.spec.ts`)

Wrap the recents click in `expect(async () => { … }).toPass()`: retry the click
until the URL carries the section, with an early return once it has navigated so
a committed navigation is never re-clicked. No assertion is weakened — the URL
must still carry the exact `section`; the retry only absorbs a click that raced
hydration.

## Data & migration impact

No schema change. Test-only.

## Tests

```bash
pnpm -C apps/web exec playwright test e2e/timetable.spec.ts
```

`playwright test --list` parses the file; the e2e job runs it in CI.

## Follow-ups

- None. If the panel later needs an interaction before hydration completes, the
  same retry pattern applies; the app could also expose a hydration marker, but
  that is not warranted for one click.
