# feat(messages): make disappearing messages legible

The after-viewing / after-24h behaviour already works (stamped and swept server
side); this adds the UI so it reads clearly. It lives in `Conversation`, so it
covers the widget and the two-pane page (and any future host) with no duplication.

## What

- A small per-message tag naming how the conversation's messages disappear:
  **"Disappears after viewing"** in after-viewing mode, **"Disappears in 24h"** in
  the 24h mode (a clock glyph + label on each message's meta line; none for
  `never`).
- **Hide on leave (after-viewing):** the messages the viewer has seen are blanked to
  "Hidden" the moment their attention leaves the thread. Navigating away or closing
  the widget unmounts the thread (removing them outright); a `visibilitychange`
  listener covers looking away in place, and they return when the viewer comes back
  (until the server expiry sweeps them). Only received messages are blanked, and only
  in after-viewing conversations.

Stays on the ios-card vocabulary, light and dark, AA, no dashes.

## Data & migration impact

None. UI only (three i18n strings).

## Tests

`apps/web` typecheck + lint + 120 unit tests (incl. the no-dash guard) green. The
stamping/sweep is covered by the messages integration suite (the recipient's read
stamps `expires_at` and reads hide it for both parties); this PR is the surfacing.

## Verification

Local browser-view is blocked by the known local tenant-resolution 404; verified by
typecheck + lint + the test suite. Once enabled for LGU: an after-viewing thread
shows the tag on each message, and switching tabs blanks the received messages to
"Hidden" until you return.
