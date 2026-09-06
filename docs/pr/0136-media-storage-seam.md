# feat(media): object storage seam + image pipeline

Lost & Found PR 1 of 5. The platform has never stored an uploaded file — every
"image" today is generated from a seed. This adds the storage seam and image
intake that Lost & Found photos (and any future uploads) sit on. No Lost & Found
code yet; this is reusable infrastructure.

## What

- **`packages/core/storage`** — the `ObjectStore` interface (`put`/`get`/
  `delete`/`url`) plus a safe key shape (`isValidObjectKey`, no traversal). Per
  CLAUDE.md §2 the vendor/impl never leaks into app code; callers depend on this
  interface only.
- **`packages/media`** (new) — the only implementation today:
  - `LocalFsStore`: an `ObjectStore` over a directory, refusing any key that
    resolves outside its root (shape check + resolved-path check).
  - `processImage`: sniffs real magic bytes (jpeg/png/webp) **before** touching
    sharp, then re-encodes to WebP — which drops all metadata, so EXIF (GPS
    included) never persists — after `.rotate()` bakes orientation. Emits a
    ≤1600 px display image and a ~400 px thumbnail; rejects unsupported types and
    oversized inputs with a typed `MediaError`.
  - `getObjectStore()` (reads `MEDIA_DATA_DIR`), `newImageKeys()` (UUID keys
    fanned out one level).
- **`apps/web/app/media/[...key]`** — dev serve route (immutable cache); in
  production nginx serves `/media/*` straight from the data dir.
- **Ops**: `sharp` added to `pnpm-workspace.yaml` `allowBuilds`; `MEDIA_DATA_DIR`
  documented in `.env.example`, declared in `apps/web/lib/app-env.vars.json` (so
  `ecosystem.config.cjs` forwards it) as optional until L&F is enabled, and
  `docs/runbooks/media-storage.md` (data dir, nginx `location /media/`, sharp).
- **`docs/design-lost-found.md`** — the approved full design + PR sequence.

## Native install (verified early)

`sharp` is native. It is allow-listed for install scripts, and the lockfile now
carries the linux binaries (`@img/sharp-linux-x64`, `-linuxmusl-x64`) alongside
win32, so CI on Ubuntu 24.04 resolves the right prebuilt binary from the
lockfile. The image tests actually invoke sharp (encode, resize, EXIF strip), so
a green CI run is the install verification on the target OS.

## Data & migration impact

No schema change (no migrations). New runtime var `MEDIA_DATA_DIR` (optional).

## Tests

`packages/media/test/` — `image.test.ts` (sniff jpeg/png/webp; downscale +
thumbnail + WebP; no-enlarge; **EXIF stripped from output**; reject non-image and
oversized) and `fs-store.test.ts` (put/get/delete round-trip + fan-out; missing
key → null; traversal key refused; `/media/` URL shape).

```bash
pnpm -C packages/media test
```

Typecheck (core, media, web) and lint verified locally; media tests pass locally
and exercise the native sharp binary.

## Follow-ups

PR 2: the Lost & Found module scaffold + data model + read-only browse.
