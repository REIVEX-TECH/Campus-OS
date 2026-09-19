# Overnight run 6 — morning report

Two features built as one coordinated set, plus a design-first empty state and the
instrumentation for a held decision:

- **A. Contextual cards** on the tenant home: dismissible, time-decayed nudges toward an
  enabled module, no personalization, no repeat for 24h once dismissed.
- **C. Official account**: a first-party `is_official` account with a profile badge that
  may post in any community (subject to the content rules), plus owner-run promote tooling
  and an ops runbook for launch posts and re-posting.
- **B. Empty states**: a one-page design, then the rides board's empty state built to it.
- **D. Held.** Notification click-through is now instrumented so a week of data can accrue
  before the decision.

Each piece is its own PR, branched off `main`, CI-green before merge. Non-obvious calls
are in `DECISIONS.md` (Run 6). **No production change**: no migration run against prod, no
deploy, no tenant flag flipped, and no account promoted; the new capability reaches a real
tenant only when a human runs the migrations and (for C) `pnpm official:promote`. LGU is
unchanged apart from the home nudges and the improved rides empty state, which every
tenant gets.

Run 5's report is in git history; this supersedes it.

---

## 1. What shipped

§6 = a concrete-SQL adversarial review applied.

| PR   | What                                                                                 | §6      |
| ---- | ------------------------------------------------------------------------------------ | ------- |
| #237 | C1: `users.is_official` (identity 0035) + profile "Official" badge, not app-writable | **yes** |
| #238 | B: empty-state design (`docs/design-empty-states.md`) + the rides board empty state  | no      |
| #239 | D: notification click-through instrumentation (`notifications.clicked_at`)           | no      |
| #240 | C2: official accounts may post in any community + `official:promote` + runbook       | **yes** |
| #241 | A: contextual cards on the tenant home (`card_dismissals`, identity 0036)            | **yes** |

### A. Contextual cards (#241)

A code catalog of small nudges (`apps/web/lib/cards.ts`), each gated on its module being
enabled, ranked by `weight x 2^(-ageDays / 30d)` with no personalization, top two shown.
Each is an accent-tinted card, visually distinct from posts, with a per-card dismiss that
hides it for 24h (server-side, own-row RLS in `card_dismissals`, identity 0036, mirroring
the verify-prompt store). Shown to signed-in members.

### C. Official account (#237, #240)

`is_official` on the account (identity 0035), unforgeable by the app (a RESTRICTIVE
`TO campusos_app` policy, the is_demo pattern), an "Official" badge on the profile read
through the public-profile view, and a rule in `createPostIn` that waives the participation
gates (verification, ban/mute, access, karma/age, unaccepted rules) for an official
account while keeping the content rules (approval, kind, flair, duplicates, rate limit) and
moderation. `pnpm official:promote` is the owner-only way to set the flag;
`docs/runbooks/official-account.md` covers launch posts and the manual re-post ops.

### B. Empty states (#238)

`docs/design-empty-states.md` sets the shape (a first-run invitation with one CTA, plus a
quieter "clear filters" variant), the first module (rides), and the metric (empty-board
CTA conversion, read via D). The rides board now shows that invitation when genuinely
empty and a "clear filters" state when only a filter emptied it.

### D. Notification instrumentation (#239)

`notifications.clicked_at` + `recordClick` (own-row, idempotent, marks read) + a
keepalive beacon on each inbox link. The decision is deferred: CTR is a documented query
run after a week of data.

---

## 2. Standing any of this up (NOT run against prod)

```bash
pnpm db:migrate:all     # applies identity 0035, 0036 and notifications 0001
# C only, per tenant, once an account has signed in and verified:
pnpm official:promote -- --tenant <slug> --handle <Handle_1234>
```

Cards, the badge, the rides empty state, and the click stamp are live from the migrations
alone; no tenant flag or deploy toggle. No account is official until promoted.

## 3. Security (CLAUDE.md 6, 8)

- **is_official is an authorization input and is not app-writable.** RESTRICTIVE
  `users_app_not_official` (0035) blocks the app role from setting it; it is read
  unforgeably (the public view for the badge, the caller's own row inside the write
  transaction for the post-anywhere decision), never from a GUC. A boundary test proves
  the app role cannot self-promote, and a communities test proves an official account may
  post where a non-member cannot while the content rules still bind.
- **The official waiver is scoped to participation, never content or safety**, and the
  account is not an admin.
- **card_dismissals and clicked_at are own-row UI state, not privileges**, under own-row
  RLS on `app.user_id`; no new definer or grant in either.
- The `public_profiles` PII-guard test was tightened to admit the one public column while
  still asserting `email`/`google_sub` are absent.

## 4. Verification

Every PR: CI green across typecheck/lint/format/build/test, integration (Postgres + RLS),
and e2e. New tests: the is_official self-promote boundary and the public-profile columns
(#237); the official post-anywhere behaviour (#240); the card selection unit tests and the
dismissal window/own-row integration test (#241); the click-through record test (#239).
The card render and the promote script are exercised where they can be (unit + CI e2e for
the auth-gated card, a load/usage check for the owner-run script), since the local sandbox
holds no signed-in session and runs nothing against a real DB.

## 5. Follow-ups

- **D decision** after a week of click-through data (the point of the hold).
- The empty-state shape adopts next for marketplace, lost-and-found, and the communities
  feed (design doc names them).
- Once a per-user signal exists (D's click-through is the first candidate), card relevance
  can move beyond time decay toward light personalization.
- The demo tenant could seed an official persona to showcase the badge (not done; no prod
  or LGU change).
