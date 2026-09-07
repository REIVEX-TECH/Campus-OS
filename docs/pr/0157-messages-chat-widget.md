# feat(messages): floating chat widget (desktop)

**Change 1 of the messages UX batch.** A Reddit-style floating chat panel on desktop
(≥1024px), toggled by the top-bar mail icon. It also introduces the shared client
data layer that change 2 (two-pane page) reuses, so no thread or list logic is
duplicated.

## Shared infra (reused by the two-pane PR)

- **GET routes** so client components fetch/poll without a full page:
  `GET /api/messages` (inbox + requests), `GET /api/messages/[id]` (a thread),
  `GET /api/messages/recipients?q=` (handle search for a new message). All behind a
  read gate (same origin, signed in, tenant from `?tenant=`, module enabled); reads
  are confined by the module's RLS. `searchProfiles` (communities) backs the picker.
- **`Conversation`** gains optional `onRefresh` / `onLeave` (default to a route
  refresh / the inbox), so a client container can drive its polling. The message,
  composer, typing and request logic are unchanged and not duplicated.
- **`ThreadView`** (fetch a thread + render `Conversation` with a re-fetch as its
  refresh) and **`ConversationList`** (active chats, then a Requests section with a
  count, polled every 15s). **`ComposeSheet`** is extracted from the Message button
  (fixed recipient on a profile; a handle search for the widget's new message).

## The widget

- A shell-level `role="complementary"` panel (labelled), bottom-right, 380×540,
  above page content, on the ios-card vocabulary (light/dark, AA, no dashes).
- Toggled by the top-bar mail icon; open/closed state and the active conversation
  persist in `sessionStorage` (guarded) and across client navigation (it lives in
  the tenant layout). Two views with a back arrow: the list and the thread.
- Header: **Chats**, new message (compose sheet), open in full (`/messages` or the
  active thread), minimize (keeps the conversation), close (returns to the list).
- Escape closes; focus moves into the panel on open and returns to the mail icon on
  close. Non-modal (no inert). Children mount only while open, so **polling runs
  only while the panel is open**.
- **Below 1024px** the mail icon navigates to the full page instead; no panel on
  phones (a media query gates both the icon behaviour and the panel).

## Data & migration impact

No schema/RLS/definer change (the GET routes are reads; `searchProfiles` reads the
`public_profiles` view under RLS), so no §6.

## Tests

`apps/web` typecheck + lint + 120 unit tests (incl. the no-dash guard) green, and
`pnpm -C apps/web build` compiles. The data-layer service functions
(`listInbox`/`listRequests`/`thread`/`searchProfiles`) are covered by the module
integration suites.

## Verification

Local browser-view of the tenant surface is blocked by the known local
tenant-resolution 404; verified by typecheck + lint + build. Once messages is
enabled for LGU: the mail icon opens the panel bottom-right, the list and a request
thread work, new message searches by handle, minimize/close/Escape behave, and
`<1024px` the icon opens the full page.

## Follow-ups

- Change 2 (two-pane full page) reuses `ThreadView` / `ConversationList`.
- Change 3 removes the sidebar Messages entry (the icon becomes the sole entry).
