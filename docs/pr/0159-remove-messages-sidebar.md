# chore(messages): remove the Messages entry from the sidebar nav

**Change 3 of the messages UX batch.** The top-bar mail icon (with its unread +
requests badge, and the floating widget on desktop) is now the single entry point
for messages, so it is no longer also a sidebar nav item.

## What

- `lib/modules.ts`: the `messages` module gains `hideFromNav: true` (like `search`),
  so it contributes no sidebar item. The route and the module are unchanged.
- Removes the now-dead sidebar-badge code: the `badge` assignment in `AppShell`'s
  nav items and the `badge` field + render in `Sidebar` (only Messages used it; the
  count now lives on the top-bar icon).

## Data & migration impact

No schema change. UI only.

## Tests

`apps/web` typecheck + lint + 120 unit tests green.

## Verification

Local browser-view is blocked by the known local tenant-resolution 404; verified by
typecheck + lint. The Messages item no longer appears in the left nav; the top-bar
mail icon remains the way in.
