# Overnight run — decisions log

One line of reasoning per non-obvious decision, per the overnight brief. Newest
at the bottom of each block.

## Block 1 — Lost & Found

- **`packages/media` as a separate package, interface in `packages/core`.** §2
  puts external services behind a core interface; the impl (`LocalFsStore`) and
  the native `sharp` pipeline live in a package so a future S3 store swaps in
  without touching callers.
- **Split `@campusos/media` into `.` (store, no native dep) and `./image`
  (sharp).** Importing the store from a Next route must not pull `sharp` into the
  bundle; `serverExternalPackages: ['sharp']` keeps it external at runtime.
- **`MEDIA_DATA_DIR` optional in the env manifest.** L&F is not enabled until the
  last PR; the app boots without it and `getObjectStore()` only throws when a
  photo op is actually attempted.
- **Image types jpeg/png/webp; HEIC deferred.** HEIC decode needs libheif in the
  sharp build, which is not verified on the target; add later if iPhone HEIC
  uploads prove common (the client can also convert).
- **`lf_items.building_id → buildings(id)` (base schema) `ON DELETE SET NULL`.**
  The "timetable buildings table" is the shared base `buildings` table; a deleted
  building must not delete the lost-item post.
- **Item creation is a direct app insert under a RESTRICTIVE own-row policy, not a
  definer.** An item is the author's own content (the communities `posts`
  pattern); only claims and moderation, which cross users, need definers.
- **Claims/claim messages are NOT tenant-wide readable.** Own/reporter RLS +
  moderator definer, mirroring the M1/M2 lesson: "who claimed what" is private.
- **Claims tables are NO FORCE.** The moderator read (PR 4b) is an owner-run
  definer; FORCE would bind the owner to the participant policy and hide claims
  from moderation. The app role is a non-owner and stays confined regardless (the
  tenant_memberships / M1 pattern). Items/photos stay FORCE (no definer reads them).
- **sharp externalized via a webpack `externals` entry, not only
  `serverExternalPackages`.** sharp is reached through the transpiled
  `@campusos/media`, and `serverExternalPackages` alone still let webpack bundle
  it (breaking the platform-binary resolution and `next build`). A verified local
  build confirmed the fix.
- **Claim notifications deferred (module independence, §4).** L&F does not write
  the communities `notifications` table (a module must not write another module's
  table). Claim activity is surfaced within L&F (reporter sees claims; my-items
  shows the claimant theirs). A shared notifications concern — also required by the
  messages module — should be core infrastructure; flagged for the messages design
  and the report.
- **L&F has its OWN moderation table (`lf_reports`), not communities' `reports`.**
  Same §4 reasoning as notifications; reusing communities' polymorphic reports
  table cross-module would couple the modules and needs its RLS to admit non-community
  reports. The messages brief asks for the shared reports table — that argues for a
  core/shared reports concern, recorded for the report; L&F stays self-contained.
- **`lostfound.moderate` granted to tenant_admin via the L&F migration.**
  `role_template_permissions` is the DB registry of role→permission (0013 already
  lists cross-module perms; 1.5b edits it), so the L&F migration adds its row +
  backfills existing tenant_admin roles. Only tenant_admin gets it.
- **Grant-based L&F moderation not wired (edge case).** `moderationQueue`/
  `removeItem` run in the member context, so a resident tenant_admin moderates; a
  platform admin under a grant passes the page gate but the definer (membership
  branch) returns empty. Threading the grant `access` through is a follow-up;
  resident-admin moderation is the primary path.
- **Posting/claiming are gated on verified membership, not a role permission.**
  Any verified member may post or claim (the approved design), so only
  `lostfound.moderate` is a role permission. It is added to the enforced
  catalogue and the `tenant_admin` role template with the moderation PR that
  checks it — not before, so no permission exists without a guard (the rbac
  principle). `role_template_permissions` (0013) is the DB source, not the TS
  `SYSTEM_ROLES`, so granting it is a migration, not a code edit.
- **New L&F definers declared in the communities `DEFINER_INTENT` map.** The
  "definer grant hygiene" test (communities integration suite) scans every
  SECURITY DEFINER in the DB and fails on any not declared; it is a global
  registry, so `auth_lf_report_queue` / `auth_lf_resolve_reports` are added there
  as `app` (both grant EXECUTE to `campusos_app` and self-gate on
  `lostfound.moderate`). The map living in communities is pre-existing; the L&F
  moderation PR keeps it honest rather than duplicating the check per module.

## Block 1 — Lost & Found — PR 5 (polish + enable)

- **LGU enabled by config in this PR (`enabledModules += 'lost-found'`).** The
  code path is complete and CI-green; the tenant flips live on the morning
  deploy. No core change — enablement is a tenant decision (§4).
- **Auto-expiry is a scheduled sweep, not a trigger or a request path.**
  `expireOpenItems(tenant)` flips overdue `open` items to `expired`; it runs with
  no actor in the tenant context, and the permissive tenant policy admits the
  update exactly like the communities archive sweep. `pnpm lostfound:expire --
--tenant <slug>` from cron (runbook: docs/runbooks/lost-found-expire.md). It
  only moves overdue open items and is idempotent.
- **"Notify 7 days before" is a live in-app badge, not a push.** Cross-module
  notifications stay deferred (§4, the notifications-concern decision above), so
  "expiring soon" is computed live from `expires_at` on My items (within
  `EXPIRY_NOTICE_DAYS` = 7) with a one-tap **Keep it listed** extend. This works
  the moment an item enters the window, independent of the sweep cadence.
  `expiry_notified_at` stays reserved for the eventual reminder's idempotency.
- **Expired items are viewable but out of default browse.** Browse only ever
  lists `open` or `resolved`; an `expired` item is still reachable by direct link
  (the item page does not filter on status) and in the reporter's My items. No
  "Expired" browse tab — that would put them back in browse.
- **Extend resets the full window and clears the notify mark.** One tap pushes
  `expires_at` to `now() + expiryDays` and nulls `expiry_notified_at`, so the
  badge and any future reminder reset together. Reporter-only, open-only (same
  guard shape as withdraw).
- **Browse filters are URL state, server-rendered.** kind / status (open|
  resolved) / category / free-text `q` are all query params carried through the
  tabs and the "more" cursor; the search+category form is a plain GET. No client
  component — the page stays a Server Component and every filter is shareable and
  back-button-correct.

## Block 1.5a — Admin can reveal a member's identity

- **A new `tenant_member_identity` side table captures name + roll at
  verification; email is read live.** The architecture keeps no real identity
  after a decision (the 0030 purge) and `users` has no name/roll, so there was
  nothing to look up later. The name/roll are captured from the still-pending
  verification detail inside `auth_verify_member` (every verify path funnels
  through it), before `decideRequest` flips the status and the purge fires —
  "copy before purge". The sign-in email is read live from `users` at reveal
  time, never snapshotted, so it cannot go stale.
- **The table has RLS on, NOT forced, and NO application-facing policy at all.**
  db-grants blanket-grants table DML to the app on every table, so RLS — not a
  missing grant — is the boundary; with zero app policy the app role (a
  non-owner) is denied every row, and the only reader is the owner-run reveal
  definer (NO FORCE lets it across). A permissive tenant policy was deliberately
  NOT added: a tenant-wide read would expose real identity to any member in the
  tenant context, exactly what this must prevent (§4/§8).
- **`auth_member_identity` is the single, audited, one-at-a-time reveal.** Gated
  on the new `view-member-identity` through `auth_effective_permissions` (never a
  bare read), refuses a non-member/cross-tenant target (empty, no leak), and
  writes a `member.identity_viewed` audit line (ids only) on every authorized
  look. No bulk variant — identity is looked at one person at a time on purpose.
- **A platform admin under a live grant CAN reveal (not excluded like
  `communities.unmask`).** `unmask` breaks a content-anonymity promise, so it is
  resident-only; revealing a member's identity is ordinary administrative tooling
  and platform admins are the platform's trusted operators, already resolving to
  the tenant_admin set under a grant. The per-reveal audit line, stamped with the
  actor, is the control — not withholding the lookup. This kept 1.5a off the
  high-blast-radius `auth_effective_permissions` (no new version needed). The
  alternative (exclude it, resident-only) is a one-migration flip, logged in
  docs/SECURITY-BACKLOG.md.
- **`view-member-identity` added to the core catalogue and the tenant_admin
  template.** The permission exists only alongside its guard (the reveal
  definer): added to `PERMISSIONS` (so it flows into `SYSTEM_ROLES.tenant_admin`)
  and to `role_template_permissions` + backfilled onto existing tenant_admin
  roles in 0031 (the lost-found 0002 pattern).
- **The members and verification explainers were corrected.** "Handles only: no
  email is shown here" was no longer true; both intros now say identity can be
  revealed and every reveal is logged, and that an approved request's name/number
  are kept (as the member's identity) while a rejected one's are discarded.
