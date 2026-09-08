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

## Block 1.5b — Only platform admins assign tenant roles

- **`manage-roles` removed from the tenant_admin template, added back to the
  grant branch explicitly.** Assigning a role (especially tenant_admin) is the
  sharpest self-perpetuating power in a tenant; it is lifted to the platform
  operator, who acts only under an audited, time-boxed grant. Migration 0032
  deletes the template row and re-syncs every tenant (auth_sync_tenant_roles is a
  full reconcile, so it strips the perm from every materialized tenant_admin
  role). Because the grant branch of auth_effective_permissions derives a
  visitor's perms from that same materialized role_permissions, the strip would
  also take manage-roles from a platform admin under a grant, who must keep it
  (the roles API gate checks it) so the resolver re-adds manage-roles EXPLICITLY
  in the grant branch, keyed on the same unforgeable txid use-row, and only there.
- **auth_set_membership_role (0029) is untouched.** A resident now fails its
  manage-roles gate (returns not_allowed); a platform admin under a grant still
  passes via the v_from_platform exemption keyed on the grant use-row. The
  keep-one-admin and not-self-under-grant rules are unchanged and still hold.
- **SYSTEM_ROLES.tenant_admin (TS) also drops manage-roles.** It is a code mirror
  (display names + a catalogue test), not the DB seed source (0013's hardcoded
  VALUES + migrations are), but keeping it honest matters; the core rbac test was
  updated to expect the two reserved exclusions (unmask, manage-roles).
- **The roles page is read-only for residents, gated on manage-members.** It was
  gated on manage-roles, which residents lose so it would 404 for them. Now
  manage-members opens the read-only catalogue; the grant-by-email control renders
  only for a holder of manage-roles (a platform admin under a grant). The nav
  entry moved to manage-members to match. Both /api/admin/roles write routes keep
  their manage-roles gate (tenantWriteContext), so a resident who forges a POST is
  404'd before the definer.
- **No auth_effective_permissions change for view-member-identity.** 0031's
  permission flows through the role_permissions branch and is not excluded; 0032
  preserves that (only communities.unmask stays excluded, plus the new explicit
  manage-roles union).

## Block 2 — Public profiles + karma

- **`postsByAuthor` now filters community visibility (the one real fix).** It
  excluded anonymous and removed posts but, unlike `commentsByAuthor`, did NOT
  require the community to be public and live, so a signed post in a
  private/restricted or dissolved community leaked onto the public profile. Added
  `visibility = 'public'` + `deletedAt IS NULL` (an inner join now), mirroring
  `readComments`, and a guarding test. This is a privacy fix, not a redesign.
- **Member-since + Admin badge come from a read-safe identity function
  (`memberPublicFacts`), composed in the web page.** §4: communities does not
  read identity's tables; the web layer composes `profileByHandle` (communities)
  with `memberPublicFacts` (identity). It runs in the tenant context (the tenant
  policy admits the membership read) and derives `isAdmin` from the unforgeable
  resolver (`auth_effective_permissions ... 'manage-members'`), so a granted admin
  counts too, not only the seeded one. It returns only join-date + a boolean, no
  name/email/verification.
- **Karma is surfaced, not redesigned.** The page now shows the existing
  post/comment split beside the total (both already on the `Karma` type); the
  private anonymous delta stays own-only via `ownKarma`.
- **The Message button is deferred to Block 3.** The messages module does not
  exist yet; the Message action lands with it. Block/Report already exist on the
  profile.
- **The moderator badge is deferred; the Admin badge ships.** A per-community
  moderator badge needs a cross-community role read; the tenant Admin badge (the
  primary staff signal) ships now. Logged as a follow-up.
- **Handles/avatars now link to the profile at the public people-lists** (the
  community members roster and the rail's moderators list); post cards, comment
  threads and L&F already linked. The blocked list was the last plain-text
  people-list and now links too (#169). The notifications actor deliberately does
  NOT link: the whole row is already a `Link` to the post, so a nested profile
  `<a>` would be invalid HTML. Admin rosters stay unlinked by design (they carry
  their own reveal/role actions, not a public-profile jump).

## Block 3 — Direct messages (new module)

- **Messages is its own module with its own reports table, not a consumer of a
  core notifications/reports seam.** §4 forbids a module writing another module's
  tables, and no shared reports/notifications concern exists in core yet. So
  messages keeps `msg_reports` (report-with-snapshot) and surfaces unread
  in-module; cross-module push notifications and a shared reports table stay the
  flagged core follow-up (already noted for L&F). Blocks are composed at the web
  route via communities' `isBlocked` (a read, not a write), and cross-module
  handle/avatar reads go through the `public_profiles` view — no messages→
  communities table coupling.
- **Participant RLS on all three tables; NO FORCE so the moderator/cleanup
  definers can read and delete across.** `msg_conversations` / `msg_messages` /
  `msg_participant_state` carry a tenant + participant policy (a row is visible
  only to `participant_a` / `participant_b`). Moderation reads and the ephemeral
  sweep run through owner-run (NO FORCE) SECURITY DEFINERs, each self-gating; the
  app role never sees another participant's thread.
- **The ephemeral cleanup sweep MUST be an owner-run definer, not an app-role
  `DELETE ... WHERE expires_at <= now()`.** This is the non-obvious one and cost a
  CI cycle: a `DELETE` (and `UPDATE`) scans the rows it removes, and that scan is
  subject to the table's _SELECT_ policy. `msg_messages`'s SELECT policy is
  participant-keyed on `app.user_id`, so the no-actor cleanup context matches zero
  rows and the sweep deletes nothing — silently. `auth_msg_expire(tenant)` (NO
  FORCE definer) does the delete, bounded to `expires_at IS NOT NULL AND
expires_at <= now()` within one tenant, and returns `ROW_COUNT`. (L&F's expire
  sweep worked as a plain app-role update only because `lf_items`' SELECT policy
  is tenant-based, not participant-based — the distinction is the lesson.)
- **`after_viewing` expiry is stamped by a definer on first read, gated on
  participation.** The viewer is the recipient, not the sender, so the own-message
  UPDATE policy would block them from setting `expires_at` on the sender's
  message. `auth_msg_stamp_viewed(tenant, conversation, grace)` does it, checking
  the caller is a participant of that specific `after_viewing` conversation
  (through the RLS-filtered `msg_conversations`, so a non-participant stamps
  nothing) and touching only unviewed inbound messages. Both definers declared
  `app` in the DEFINER_INTENT registry.
- **Reads hide expired messages immediately; the sweep only reclaims storage.**
  Every read query (`thread`, inbox preview, `unreadCount`) filters
  `expires_at <= now()`, so a message disappears from the UI the instant it
  expires regardless of when the 15-minute cron next runs. The cron is a
  storage-hygiene job, never the privacy boundary.

---

# Overnight run 2 — decisions log

Newest at the bottom of each block. Same one-line-per-decision rule.

## Block 0 — finish the media/L&F queue

- **`/media` is excluded from the tenant rewrite in two places.** The matcher
  negative-lookahead now lists `media` (so the middleware never runs for object
  storage, mirroring `api`), and `planRoute` short-circuits `/media/...` to
  `next` before the subdomain rewrite. The matcher is the real fix; the
  `planRoute` guard is the unit-tested one, since matcher regexes are awkward to
  assert. The bug it closes: on a tenant subdomain, `/media/x.webp` was being
  rewritten to `/u/{label}/media/x.webp`, which 404s.
- **`MEDIA_DATA_DIR` is now `requiredInProduction` in `app-env.vars.json`.** Photos
  are no longer an optional feature (L&F is live, marketplace is coming), so the
  boot check fails closed if it is unset in production rather than letting uploads
  throw at runtime. The runtime read in `getObjectStore()` already threw; this
  moves the failure to boot where it is visible.
- **The e2e image-upload test posts a 1x1 PNG through the real pipeline and fetches
  the resulting `/media` URL.** It needs a genuine image (sharp decodes it), so a
  fake buffer would not do; the bytes are an inline base64 PNG rather than a
  committed binary fixture. `MEDIA_DATA_DIR` for the e2e web server points at a
  temp dir (the store creates it on first write).
- **Lost & Found leaked photo files on withdraw/remove/expire.** Those transitions
  only flipped `lf_items.status`; the `lf_item_photos` rows and object-store files
  were never touched (the `removed_at` column was dead). Fix: `withdrawItem` and
  `removeItem` hard-delete the photo rows in the same transaction and return the
  storage keys; the web route deletes the files after commit (best-effort,
  missing-object-safe). Scope is withdraw + remove per the brief; expire and resolve
  still retain photos (resolved stays viewable; a GC sweep is the general answer),
  flagged as a follow-up. The service's ownership/moderation gate is the access
  check, not the tenant-only RLS on the photos table.
- **"Cards and IDs" warning is a client-side conditional note** on the L&F post
  form; no server change.

## Block 1 — Marketplace, goods

- **New module `packages/modules/marketplace`**, own bookkeeping table, opt-in via
  `enabledModules` ('marketplace'). Added to the ROOT workspace deps (resolution is
  walk-up, mirroring lost-found); not in apps/web deps or `transpilePackages`
  (server-side domain logic only).
- **`0000` mirrors the L&F `0000` §6 pattern**: `mkt_listings` + `mkt_listing_photos`,
  `tenant_isolation` + FORCE on both, RESTRICTIVE insert seller-self / photo-owner-
  self. No definer, no grant change, no money (goods are cash-on-meetup, no fee).
- **Price is integer paisa (PKR) stored as bigint** so no amount overflows; a
  per-listing cap (`maxPricePaisa`) guards a typo, not policy. `price_kind` =
  fixed|negotiable; condition = new|like-new|used|for-parts; status =
  active|reserved|sold|expired|removed.
- **`mkt_listing_photos` has no dead `removed_at`** (unlike L&F): the marketplace
  deletes photo rows + files on removal from the start.
- **Contact info in a listing is refused** (a 7+ digit run or "whatsapp"/"wa.me")
  so contact stays in the messages module (block/report/audit live there). A
  usability guardrail, not a security boundary (moderation is).
- **Message seller** reuses the messages `ComposeSheet` (new optional `initialDraft`)
  with the listing title + link prefilled; shown only where messages is enabled and
  the viewer is not the seller.
- **Seller withdrawal is a soft-delete (`deleted_at`)**, not a status, keeping
  'removed' for moderation. `setListingStatus` allows only active->reserved,
  active/reserved->sold, {reserved,sold,expired}->active (relist).
- **Sold-hide is a read filter** (`soldVisibleDays`, default 7) on the detail page;
  **auto-expire is a plain tenant-context UPDATE** (the SELECT policy is tenant-based,
  the L&F expiry precedent, so no owner-run definer is needed).
- **`mkt_saved` is own-row RLS on `app.user_id` + tenant + FORCE** — per-user DATA
  isolation (bookmarks), the standard own-row pattern, NOT a privilege decision, so
  keying on `app.user_id` is correct (section 8 forbids it only for PRIVILEGE
  decisions). [saved-listings PR]
- **The module-hub card stays soon:true until Block 5**, where the flip to live +
  LGU enablement + the `seo`/`shell` test updates happen together (flipping it early
  broke `seo.spec`'s `/soon/marketplace` and `shell.spec`'s "Marketplace" soon-item).

## Block 2 — Marketplace services (gigs, orders)

- **Services live in the marketplace module, behind a separate flag**
  (`marketplace-services`), not a new module: goods and services share categories,
  moderation, and the media pipeline. A gig is text + one-to-three tiered packages
  (`mkt_gigs` / `mkt_gig_packages`, migration 0003), RLS mirroring goods
  (tenant-isolation + FORCE + RESTRICTIVE insert-as-self).
- **Gig photos deferred.** A gallery would be the THIRD copy of the photo
  table/write pattern (L&F, goods, gigs) — the point CLAUDE.md says to extract into
  `shared-listings`. That refactor touches merged code and is risky overnight, so
  gigs ship text+packages+reviews; the gallery + extraction is a logged follow-up.
- **The order state machine is one SECURITY DEFINER** (`mkt_order_transition`,
  migration 0004): it locks the order row `FOR UPDATE`, derives the actor's role
  (buyer/seller) FROM THE ORDER, validates the edge for that role and status, writes
  status + timestamps, and appends one `mkt_order_events` row — atomically. Keying
  on `app.user_id` here is DATA ownership (is the actor this order's party), the
  accepted use, NOT a privilege decision.
- **Orders are created only by `mkt_place_order`**, which derives the price/turnaround
  snapshot from the package itself, so a raw write cannot forge the agreed amount.
- **Append-only, no app writes**: `INSERT/UPDATE/DELETE` on `mkt_orders` and
  `mkt_order_events` are revoked from `campusos_app` by name; the app only SELECTs
  its own (party RLS). Same discipline as the membership tables (0019). Reviews are
  tenant-wide read, buyer-written once (RESTRICTIVE "earned" check + unique).
- **payment_mode cash|online**: cash skips awaiting_payment/paid (accept ->
  in_progress); online goes requested -> awaiting_payment -> paid -> in_progress.
  The `paid` edge is buyer-triggered for now; Block 4 adds the ledger write and
  payment verification. This keeps the workflow shippable without the money rail.
- **Dispute RESOLUTION is deliberately NOT in the state machine**: opening a dispute
  is a buyer action, but deciding one is a platform privilege that must be gated on a
  grant (§8) — it ships with the finance admin (Block 4), not here.
- **Delivery files extend `@campusos/media` with `./file`** (migration-free):
  `validateUploadFile` does a magic-byte check against a small allowlist (pdf, zip,
  docx, xlsx, pptx), stored as sent and served `Content-Disposition: attachment`.
- **Services stay disabled for LGU** (goods only), per the brief.

## Block 3 — Money

- **The payment vendor seam is `@campusos/core/payments`** (§2): `PaymentProvider`
  with `ManualTransferProvider` (production default, no paid gateway) and
  `FakeProvider` (tests). Fee math is integer paisa, rounding down
  (`PLATFORM_FEE_BPS = 1000` = 10%), the single TS source of truth.
- **The ledger is a new platform-level module `@campusos/module-money`** (no routes,
  nav, or tenant settings — tenant admins never see finance). `ledger_entries` is
  append-only, double-entry; balances are sums, never stored; every transaction's
  amounts sum to zero.
- **`money_post_txn` is the ledger's ONLY writer**: owner-only SECURITY DEFINER,
  revoked from PUBLIC and never granted to the app, enforcing sum-to-zero, non-zero
  entries, and idempotency per `txn_id`. The app can neither write `ledger_entries`
  nor execute the writer (both proven in the integration test).
- **`tenant_id` on the ledger is a plain slug, no FK**, so no tenant lifecycle
  cascade can mutate an append-only financial row.
- **Deferred to Block 4 (finance admin), NOT built — needs the human §6 SQL review**
  the brief mandates (money escalations were caught only at implementation review
  twice): the `payments` table + manual receipt upload + confirm/reject, escrow
  release on order completion, payouts with `PAYOUT_ENCRYPTION_KEY`, refunds/splits,
  and the platform `/admin` finance surfaces. All are platform-privilege actions to
  be gated on a live platform grant use-row (unforgeable), and all call
  `money_post_txn` (owner->owner) to move money atomically with the ledger.

## Environment note (2026-09-08, during the run)

- Mid-run, `nvm use` and `corepack pnpm` began hanging on a network check on this
  machine. Worked around by invoking the corepack-cached pnpm directly via the
  Node binary with `COREPACK_ENABLE_NETWORK=0` (bypassing corepack's network
  verification). All local typecheck/lint and the money commit hook ran green this
  way; CI (its own clean environment) is the authoritative gate.

## Run 3 — Block A

- **A1 tenant-editor drift** — compare the effective (DB) `enabledModules` to the
  file config's, from the already-loaded registry (no extra query); warn only when a
  DB row exists and differs. Source of truth stays "DB wins".
- **A2 notifications seam** — a new `packages/modules/notifications` takes ownership
  of the shared `notifications` table via a DDL-only migration (adds `payload`+`link`,
  relaxes `community_id` NOT NULL, adds the `notifications_emit` definer; existing
  rows untouched, RLS unchanged). It runs after communities in migrate-all because it
  ALTERs a table communities creates; that migration-order dependency is deliberate.
  **Communities keeps its own `communities_notify` + rich inbox render unchanged**
  (lowest risk, best UX) and simply shares the now-generalised table; other modules
  emit generic (payload+link) rows through `notify()`. The apps/web inbox merges the
  communities view and the generic view; the bell counts every unread row
  (kind-agnostic) and is ungated from communities. The legacy communities FKs on the
  table are left in place (a full decouple would change cascade cleanup; logged as a
  follow-up). `notifications_emit` is 'app' in DEFINER_INTENT: a notification is data,
  not a privilege; tenant from the GUC (isolation), recipient explicit, app still has
  no direct INSERT.
- **A6 backup freshness check** — `docs/runbooks/backup.md` already matches main
  (nightly `pg_dump`/encrypt/rsync + a human restore drill), so the only gap was
  noticing a night with no dump. Added `scripts/backup-check.sh` (shipped, unlike the
  host-specific `backup.sh` the runbook only documents): it exits non-zero if the
  newest `campusos-*.dump.gpg` in `$BACKUP_DIR` is missing or older than
  `MAX_AGE_HOURS` (default 26 = 24h cadence + 2h grace). Checks the LOCAL backup dir,
  not the off-box copy (that is the remote's own alarm), and reports the newest dump's
  age. The restore drill stays a human step by design (needs real PG client tools and
  the operator's private GPG key, neither in CI).

## Run 3 — Block B (rides)

- **Design first, then build in five PRs** (`docs/design-rides.md`): the module is
  large, so it lands backend-first (schema/RLS/read/write, integration-tested) then
  UI, then seat requests, ratings, safety, lifecycle — the same shape marketplace
  used. Flag `rides`, disabled everywhere.
- **No gender is stored, ever.** "Women only" is a boolean LABEL the author sets on a
  ride and a browse filter — self-declared, unverified, enforced socially, exactly as
  a physical notice board would. The alternative (storing or verifying a user's
  gender) is a data-minimisation and safety line the product does not cross. The UI
  states plainly that it is driver-set and not platform-verified.
- **No in-app money, and contact details are scrubbed from free text.** There is no
  fare/fee; `notes` is rejected on save if it contains an email, a messaging-app
  handle, or a phone number, so a ride board cannot become a fee-negotiation or
  off-platform-contact channel. Coordination happens in the in-app conversation the
  (later) accept flow opens.
- **Rides → messages is the one accepted cross-feature dependency.** Accepting a seat
  (a later PR) opens a messages conversation with a system line; rides will depend on
  `@campusos/module-messages` the way the A2 emitters depend on the notifications
  module, and degrade gracefully (notify only) when messages is disabled. A core
  "conversation" interface is the cleaner long-term shape, logged as a follow-up.
- **Departure time**: a one-off ride stores a concrete UTC `depart_at`; a recurring
  offer stores wall-clock time + ISO weekdays and each spawned occurrence's instant
  is computed through the tenant timezone (CLAUDE.md §5), correct across DST. A
  unique `(recurrence_parent_id, depart_at)` makes the spawn idempotent.
- **PR 1 posts pattern, no definer.** `ride_posts` is tenant-wide readable, written
  only as oneself (RESTRICTIVE insert-as-self + FORCE); edits/cancels are scoped to
  the author in the app SQL. Definers arrive with seat requests (cross-user accept)
  and moderation. The block filter runs in the viewer's actor context so
  `auth_blocked_between` sees the viewer.
