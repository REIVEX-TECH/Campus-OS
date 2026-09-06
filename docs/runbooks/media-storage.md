# Media / object storage

How uploaded blobs (Lost & Found photos today) are stored and served. The
product writes blobs through the `ObjectStore` seam (`packages/core/storage`),
whose only implementation today is a local filesystem store (`@campusos/media`,
`LocalFsStore`). An S3-compatible store (R2 / MinIO / B2 / Supabase) can be added
behind the same interface later without changing any caller — deferred until
needed.

## The data directory

`MEDIA_DATA_DIR` is the directory blobs live in. It MUST be **outside the repo**
(it is user data, not code) on a volume with room to grow. The app creates
sub-directories under it; keys are unguessable UUIDs fanned out one level
(`lost-found/<xx>/<uuid>.webp`, plus a `_thumb.webp` variant).

```bash
sudo mkdir -p /var/lib/campusos/media
sudo chown "$USER":"$USER" /var/lib/campusos/media   # the user pm2 runs the app as
```

Set it in `.env` (`MEDIA_DATA_DIR=/var/lib/campusos/media`). It is a runtime var
in `apps/web/lib/app-env.vars.json`, so `ecosystem.config.cjs` forwards it
automatically; `pm2 restart ecosystem.config.cjs --update-env` after adding it.
It is optional until a tenant enables Lost & Found — the app boots without it and
only fails when a photo operation is actually attempted.

## Serving

Blobs are addressed at `/media/<key>`. Keys are immutable (a new upload gets a
new UUID), so responses are cached hard (`public, max-age=31536000, immutable`).

- **Production: nginx serves the directory directly** — Node never touches image
  bytes. Add, inside the app `server {}` block, BEFORE the `location / { proxy_pass }`:

  ```nginx
  location /media/ {
      alias /var/lib/campusos/media/;
      access_log off;
      add_header Cache-Control "public, max-age=31536000, immutable";
      try_files $uri =404;
      # Optional hardening: only serve the extensions we write.
      location ~* \.(webp)$ { }
  }
  ```

  (`alias` with the trailing slashes maps `/media/lost-found/ab/uuid.webp` →
  `/var/lib/campusos/media/lost-found/ab/uuid.webp`.)

- **Development / fallback:** the Next route `apps/web/app/media/[...key]/route.ts`
  reads through the same store and applies the same cache header. It also works in
  production as a correct fallback if nginx is ever bypassed, just slower.

## Image handling (`@campusos/media`)

Uploads are never stored as sent. `processImage` sniffs the real magic bytes
(jpeg / png / webp — HEIC is excluded until libheif is verified in the sharp
build) **before** handing anything to sharp, then re-encodes to WebP after baking
in the EXIF orientation — which drops all metadata, so EXIF (GPS included) never
persists. Two variants are produced: a display image bounded to 1600 px and a
~400 px thumbnail. Size and count limits live in the module settings.

`sharp` is a native dependency. It is allow-listed for install scripts in
`pnpm-workspace.yaml` (`allowBuilds: sharp`). On a fresh server:

```bash
pnpm install   # fetches the prebuilt sharp binary for the platform
```

If sharp fails to load at runtime (`Could not load the "sharp" module`), the
prebuilt binary for the platform was not installed — re-run `pnpm install` on the
target OS/arch (do not copy `node_modules` between platforms).
