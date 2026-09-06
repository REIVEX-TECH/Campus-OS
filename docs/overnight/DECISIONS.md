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
- **Posting/claiming are gated on verified membership, not a role permission.**
  Any verified member may post or claim (the approved design), so only
  `lostfound.moderate` is a role permission. It is added to the enforced
  catalogue and the `tenant_admin` role template with the moderation PR that
  checks it — not before, so no permission exists without a guard (the rbac
  principle). `role_template_permissions` (0013) is the DB source, not the TS
  `SYSTEM_ROLES`, so granting it is a migration, not a code edit.
