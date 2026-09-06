# Lost & Found — design

Approved design for the Lost & Found module. Communities is the reference content
module; L&F reuses its moderation/notification/feed stack and adds the one thing
the platform has never had: user photo uploads.

## Decisions (locked)

- **Pseudonymous only.** Items show the reporter's handle + procedural avatar,
  never email/real name; contact happens in-app through the claim thread. No
  anonymous-poster option.
- **Storage: local filesystem behind the `ObjectStore` seam.** No S3 adapter in
  this sequence (added later behind the same interface if needed). `sharp` for
  image processing (native, MIT), install verified on Ubuntu 24.04 / pnpm in CI.
- **Photos** served by **nginx** from the data dir in production (UUID keys, long
  immutable cache); a Next route is the dev/fallback path. A ~400 px **thumbnail**
  is generated at upload alongside the ≤1600 px display image. A **magic-byte type
  check and a per-user upload rate limit run before sharp.** The data dir lives
  **outside the repo**, its path in `.env` / `ecosystem` / the deploy runbook.
- **Claims** carry a private **message thread** between claimant and reporter;
  reporter confirms → item resolves. Claiming requires verification.
- **Categories** are tenant-configurable (defaults: electronics, cards & IDs,
  keys, bags, clothing, books, other). Open items **auto-expire at 90 days**, with
  a **7-day-before notice** and **one-tap extend**; expired items remain viewable
  but drop out of default browse.
- **Location** is free text, with an optional **building** chosen from the
  timetable buildings table.
- **§8:** reporting + blocking + a moderation queue ship in the SAME release as
  claims (strangers connect); the module stays disabled for all tenants until that
  lands.

## Data model (`packages/modules/lost-found/`)

Communities conventions throughout (`tenant_id` on every row, soft-delete,
moderation-lifecycle columns, RLS ENABLE + FORCE + `tenant_isolation` loop,
own-row RESTRICTIVE insert, keyset-cursor composite indexes).

```
lf_items          id, tenant_id, reporter_id, kind('lost'|'found'), title, description,
                  category, location_text, building_id? (→ timetable buildings), happened_on,
                  status('open'|'resolved'|'withdrawn'|'removed'|'expired'),
                  resolved_via_claim_id?, resolved_at, expires_at, expiry_notified_at,
                  removed_at/removed_by/removal_reason, edited_at, deleted_at, created_at
lf_item_photos    id, tenant_id, item_id, storage_key, thumb_key, content_type, width, height,
                  byte_size, position, removed_at, created_at
lf_claims         id, tenant_id, item_id, claimant_id, message,
                  status('pending'|'approved'|'denied'|'withdrawn'), decided_at, deleted_at, created_at
                  partial unique (item_id, claimant_id) WHERE status='pending'
lf_claim_messages id, tenant_id, claim_id, sender_id, body, created_at
```

Reused unchanged (polymorphic — take a new type string, no migration to them):
`reports` (`lf_item`/`lf_claim`), `moderation_actions`, `notifications`,
`user_blocks`, `saved_items`.

**Privacy (the M1/M2 lesson):** `lf_items`/`lf_item_photos` are tenant-wide
readable (browse). `lf_claims`/`lf_claim_messages` are NOT — RLS
`USING (claimant_id = app.user_id OR EXISTS (select 1 from lf_items i where
i.id = item_id and i.reporter_id = app.user_id))` (data isolation), with moderator
reads through a `SECURITY DEFINER` gated on `lostfound.moderate` via
`auth_effective_permissions` (the M1 `auth_pending_verification_requests` shape).
Verified-only posting and claiming are enforced in the write path
(`isVerifiedMember` → `not_verified`), backed by the RESTRICTIVE author-is-self
insert policy and the `verify-gate` UI — not via `auth_effective_permissions`
(which doesn't encode `verified_at`).

## Image upload

- `ObjectStore` interface in `packages/core/storage`; `LocalFsStore` +
  `processImage` in `@campusos/media`.
- Server-mediated upload: client POSTs multipart → per-user rate limit → size cap
  → **magic-byte sniff (jpeg/png/webp)** → `sharp` (`.rotate()` bakes orientation,
  re-encode WebP drops EXIF/GPS, downscale ≤1600 px + a ~400 px thumb) → moderation
  hook (default no-op; photos reportable + admin-removable) → `ObjectStore.put`
  (full + thumb keys) → `lf_item_photos`. Limits (size, count) in module settings.
- Keys are UUIDs fanned out one level (`lost-found/<xx>/<uuid>.webp`,
  `..._thumb.webp`); served at `/media/<key>` (nginx prod, Next route dev).

## UI (Reddit-style, iOS-clean)

Routes under `apps/web/app/u/[slug]/lost-found/`: **browse** (item cards, filters
as `<Link>` tabs — lost/found, category, status, search; keyset "more"), **item
page** (photo gallery, details, claim button, reporter's claim list + thread),
**post form** (kind/title/description/category/location+building/date/photos, with
the `GetVerified` wall), **my items** (posts + claims tabs), **mod** (reused
`ModQueue`). Reuse: `post-card`→item card, `post-form`→item form,
`comment-thread`→claim thread, `feed-tabs`→filters, report panel, `report-person`,
`block-button`, `ModQueue`, `EmptyState`, `PageShell`, `IdentityAvatar`, the
`ios-card`/`ios-field`/pill vocabulary. Build: the photo picker/preview/gallery.

## Manifest, permissions, admin

`packages/modules/lost-found/src/manifest.ts` — `id: 'lost-found'`,
`migrationsTable: '__drizzle_migrations_lost_found'`, `settingsSchema` (categories,
maxPhotosPerItem, maxUploadBytes, reportThreshold, expiryDays default 90),
`permissions` (`lostfound.post`, `lostfound.claim`, `lostfound.moderate`). Register
in `scripts/migrate-all.ts`; add the permission keys to
`packages/core/src/rbac/index.ts` (student/teacher: post+claim; admin/mod:
moderate); flip the nav stub in `apps/web/lib/modules.ts`; tenant opts in via
`enabledModules`. Moderation reuses `reportItem`/`listQueue`/`removeItem`/
`resolveReports`/`logAction`/`banMember`/`blockUser` + `ModQueue`, adding the
`lf_item`/`lf_claim` types and an item-remove action, on a single tenant-level L&F
mod page.

## PR sequence

1. **Storage seam + image pipeline** — `packages/core/storage` `ObjectStore`,
   `@campusos/media` (`LocalFsStore` + `sharp` pipeline: magic-byte sniff, EXIF
   strip, resize, WebP, thumbnail), dev serve route, `sharp` in pnpm `allowBuilds`,
   `MEDIA_DATA_DIR` in env/ecosystem + runbook, unit tests. _(this PR)_
2. **Module scaffold + data model + browse** — package, manifest, `0000` migration
   (`lf_items` + `lf_item_photos` + RLS + indexes + building FK), permission keys,
   register + nav, read-only browse + item page. §6 the RLS.
3. **Post an item** — create service (verified-gate, per-user rate limit), photo
   upload wired to storage, item form, my-items (posts).
4. **Claims + moderation** (may split 4a claims / 4b moderation; both merge before
   enablement) — `lf_claims` + `lf_claim_messages` + RLS + the gated moderator
   definer, claim flow (open/thread/confirm/reject/resolve) + notifications, and
   reporting/blocking/`ModQueue`/remove-ban + the mod page. §6 the claim RLS +
   definer.
5. **Polish + enable for LGU** — filters/sort/FTS search, 90-day expiry job (7-day
   notice + one-tap extend), a11y, empty states, flip `enabledModules` for LGU,
   docs/PR bodies.
