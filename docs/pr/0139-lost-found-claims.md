# feat(lost-found): claims lifecycle and private claim threads

Lost & Found PR 4a. A verified member can claim an item; the reporter and the
claimant hold a private thread; the reporter confirms (resolving the item and
denying the rest) or rejects, and the claimant may withdraw. This is the
user-to-user surface, so PR 4b (reporting + moderation) lands before the module
is enabled for any tenant.

## What

- **Migration `0001_lost_found_claims.sql`**: `lf_claims` and `lf_claim_messages`,
  plus the `lf_items.resolved_via_claim_id` FK. **Not tenant-wide readable** — RLS
  confines them to the two participants (the claimant, or the item's reporter),
  with a partial unique index for one open claim per person per item. RLS is
  enabled but NOT forced, so a later moderator definer (owner-run, PR 4b) can read
  across participants; the application role, a non-owner, stays confined.
- **Module `claims.ts`**: `openClaim` (verified non-owner, open item, once),
  `sendClaimMessage`, `confirmClaim` (reporter → item resolved, other pending
  claims denied), `rejectClaim`, `withdrawClaim`, `listClaimsForItem`,
  `claimThread`, `myClaims`. Verification and role are re-checked in each
  transaction. `isVerifiedMember` moved to a shared `access.ts`.
- **API** (`/api/lost-found/claims`, `/claims/[id]`): open a claim, and
  message / confirm / reject / withdraw, behind the same `lostFoundGate`.
- **UI**: the item page gains a claim area — a claim form for an eligible viewer
  (verified, not the reporter, item open), the reporter's list of claims with
  confirm/reject, and the private message thread (selected via `?claim=`); the
  my-items page gains a "my claims" section.

## Privacy (§6, concrete SQL)

Claims and messages are visible only to participants: the `lf_claims` policy is
`tenant AND (claimant = app.user_id OR item.reporter = app.user_id)`; messages
are visible exactly when their parent claim is (a subquery under the claim policy).
Inserts are RESTRICTIVE as-self (claimant, sender). This is data isolation keyed on
`app.user_id` (reading your own claims, or claims on your item) — not a privilege
decision — and no `current_setting('app.*')` gates a privileged write. NO FORCE is
deliberate and documented (moderator definer reads via owner-bypass next PR). No
SECURITY DEFINER in this migration.

## Notifications (deferred, §4)

Claim notifications are **not** wired to the communities `notifications` table:
a module writing another module's table breaks module independence (§4). Claim
activity is surfaced within Lost & Found instead (the reporter sees claims on the
item; my-items shows the claimant their claims). A shared notifications concern
(also needed by messages) should be core infrastructure; recorded in
`docs/overnight/DECISIONS.md` and the report.

## Data & migration impact

Module migration `0001` (own bookkeeping table). Adds two tables + one FK. No
change to existing tables. Nothing runs for a tenant until the module is enabled
(after PR 4b).

## Tests

`lost-found.integration.test.ts` gains a claims suite (split DB): open only as a
verified non-owner, once; a claim and its messages are private to the two
participants (a stranger sees neither and cannot message); reporter confirm
resolves the item and denies the rest, and a non-reporter cannot confirm.
Typecheck, lint, and a local `next build` (the sharp externals fix from PR 3 keeps
the upload route building) verified; the RLS suite runs in CI.

## Follow-ups

PR 4b: reporting + blocking + the moderation queue + the moderator definer +
`lostfound.moderate` (the §8 baseline), then PR 5 enables the module.
