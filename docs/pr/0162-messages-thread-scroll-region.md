# fix(messages): make the thread an internal scroll region

The thread scrolled the whole page: a long conversation pushed the composer off
the bottom and the page grew instead of the messages. This makes the thread a
self-contained column that fills the viewport below the top bar, with the header
and the composer pinned and only the message list between them scrolling. It
lives in the shared `Conversation` component, so the two-pane page and the widget
both get it.

## What

- **`Conversation`** is now a bounded flex column (`min-h-0 flex-1`): the
  conversation chrome (the disappearing control, an inbound request's
  accept/decline) is pinned at the top, the composer is pinned at the bottom, and
  the message list is the only scroll region (`flex-1 overflow-y-auto`, the old
  `min-h-[40vh]` removed so it fills instead).
- **Follow to newest, without yanking.** On open and whenever a message arrives
  from either side, the list scrolls to the newest message only if the reader is
  already at the bottom; the reader's own send always follows. If they have
  scrolled up to read history, they stay put and a small **"New messages"** pill
  appears that scrolls to the bottom on tap. The pill clears once they are back at
  the bottom.
- **Two-pane page** (`MessagesScreen`): the column is `100dvh` minus the top bar
  (was `svh`) and `overflow-hidden`, so `/messages` has no page-level scroll. The
  conversation list column keeps its own independent scroll.
- **Widget** (`ChatWidget`): the panel body no longer scrolls as a whole; the
  thread scrolls its own message list with the composer pinned, and the list view
  has its own scroller.
- **Phone:** the same column, sized in `dvh` so the composer sits above the
  keyboard rather than behind it. Below 1024px the stacked list and thread each
  fill the screen and scroll internally.

Stays on the ios-card vocabulary, light and dark, AA, no dashes.

## Data & migration impact

No schema change. UI only (one i18n string, `messages.newMessages`).

## Tests

- `apps/web` typecheck, lint, format and the unit suite (incl. the no-dash guard)
  are green.
- The messages e2e (`e2e/messages.spec.ts`) gains an assertion that the thread's
  message list is its own scroll region (`overflow-y: auto`), so a regression back
  to page-level scroll fails CI. The existing render assertions still pass through
  the new layout.

## Verification

1. Open a conversation with enough messages to overflow: the page does not scroll,
   the message list does, and the composer stays pinned at the bottom.
2. Scroll up to read history, then have the other side send a message: the view
   stays put and a "New messages" pill appears; tapping it scrolls to the newest.
3. Send a message yourself: the list follows to the bottom.
4. On a phone, focus the composer: it sits above the keyboard.
5. The same holds in the desktop chat widget.

## Follow-ups

None.
