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
