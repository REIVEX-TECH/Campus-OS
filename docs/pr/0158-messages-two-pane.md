# feat(messages): two-pane full page on desktop, stacked on mobile

**Change 2 of the messages UX batch.** The full messages page becomes two panes on
desktop and keeps the stacked list -> thread pattern on phones, reusing the same
components as the widget (change 1).

## What

- **`MessagesScreen`** (client): the list on the left (~320px), the selected thread
  on the right, an empty "select a conversation" state when nothing is chosen. Below
  1024px it is stacked: the list fills the screen, and a selected conversation shows
  the thread full-width with a back link. Reuses `ConversationList` + `ThreadView`
  and adds a new-message compose button.
- It lives in **`messages/layout.tsx`**, so it is drawn once: selecting a
  conversation is a soft navigation (`router.push`) that updates the URL and the
  active pane without reloading the list. The active conversation is the `[id]`
  route param, so `/u/[slug]/messages/[id]` deep links still work.
- The `messages` and `messages/[id]` pages now carry only their metadata (the
  layout draws the screen), so there is no duplicated thread or list logic and no
  separate server-rendered thread page.

Reddit's chat layout is the reference for density; the surface stays on ios-card,
light and dark, AA, no dashes.

## Data & migration impact

No schema/RLS/definer change; UI + one i18n key. No §6.

## Tests

`apps/web` typecheck + lint + 120 unit tests (incl. no-dash) green;
`pnpm -C apps/web build` compiles (the messages routes are now client-driven behind
the shared GET data layer from change 1).

## Verification

Local browser-view is blocked by the known local tenant-resolution 404; verified by
typecheck + lint + build. Once enabled for LGU: on desktop the list and thread sit
side by side, selecting one updates the URL without a reload and deep links open the
right thread; below 1024px it is the stacked list then thread with a back link.

## Follow-ups

- Change 3 removes the sidebar Messages entry.
