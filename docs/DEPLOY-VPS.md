# Deploying Campus OS on a self-hosted VPS (lgu.reivex.io)

A step-by-step runbook for **your** box: Ubuntu 24.04, an already-running shared
Postgres 16 on `127.0.0.1:5432`, nginx 1.24 terminating TLS for other
`*.reivex.io` vhosts, apps managed by pm2, app port **3003**. You run every
command; nothing here runs against your server on its own.

Each step is marked:

- 🟥 **SHARED INFRA** — touches Postgres or nginx that other apps use. Run
  carefully; the commands are scoped to CampusOS only and never alter other
  databases or vhosts.
- 🟩 **CAMPUSOS-LOCAL** — confined to the CampusOS repo / its own pm2 app. Safe.

Data decision baked in: deploy with `SOURCE_MODE=fixture` now (the recorded
slice), backfill the full live data later (step 8).

> **Tenant routing sanity check (why this works).** The middleware resolves the
> tenant from the request `Host` header. `subdomainOf('lgu.reivex.io', 'reivex.io')`
> returns `'lgu'`, which resolves the `lgu` tenant. So with `APP_DOMAIN=reivex.io`
> and nginx forwarding the real `Host`, `lgu.reivex.io` serves the `lgu` tenant
> with no per-host config. (Verified against `packages/core/src/tenant/registry.ts`.)

---

## 1. Prereqs 🟩 CAMPUSOS-LOCAL

Node 22 via nvm (leaves your system Node 20 untouched), pnpm via corepack, and
the repo cloned. Run as the user that owns your pm2 apps (you use root).

```bash
# nvm (skip if already installed)
command -v nvm >/dev/null || {
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
}

# Node 22 for CampusOS ONLY (do not change your default):
nvm install 22
nvm which 22          # note this path; you will use it below as CAMPUSOS_NODE

# pnpm via corepack, pinned to the repo's packageManager (pnpm@11.24.0):
corepack enable
corepack prepare pnpm@11.24.0 --activate

# Clone:
mkdir -p /root/codes && cd /root/codes
git clone https://github.com/REIVEX-TECH/Campus-OS.git campusos
cd /root/codes/campusos
nvm use 22            # this repo ships an .nvmrc pinning 22
node -v               # expect v22.x (>= 22.13, satisfies engines)
```

---

## 2. Database 🟥 SHARED INFRA (your hands)

Create ONLY the CampusOS role and database on the shared cluster. The provided
`scripts/db-bootstrap-prod.sql` is idempotent and never touches other databases.

```bash
cd /root/codes/campusos

# Choose a strong password (no single quotes). Store it; you will put it in .env.
# Run the bootstrap as the postgres superuser, passing the password at runtime:
sudo -u postgres psql -v app_password="PASTE_STRONG_PASSWORD_HERE" \
  -f scripts/db-bootstrap-prod.sql
```

What it does (and nothing else):

- `CREATE ROLE campusos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`
  — **NOBYPASSRLS is critical**; without it row-level security is void.
- `CREATE DATABASE campusos OWNER campusos_app` — only if absent.
- Makes `campusos_app` own the `public` schema inside `campusos` so migrations
  can create tables.

Confirm the role and database exist and nothing else changed:

```bash
sudo -u postgres psql -c "\du campusos_app"
sudo -u postgres psql -c "\l campusos"
```

If your `pg_hba.conf` restricts local TCP auth, ensure `campusos_app` can connect
to `campusos` over `127.0.0.1` with a password (scram-sha-256/md5). This is the
only pg_hba consideration and it is scoped to this role+db.

Then apply the schema and seed the tenant row 🟩 (CampusOS-local, but writes to
the shared cluster's `campusos` DB only). Do this after step 3 creates `.env`:

```bash
# (after .env exists, see step 3)
set -a; . ./.env; set +a
pnpm db:migrate:all     # base + module migrations: schema + FORCE RLS policies
pnpm db:seed            # upserts the `universities` row for the lgu tenant
```

---

## 3. Environment 🟩 CAMPUSOS-LOCAL

Create the production `.env` at the repo root (git-ignored; documented in
`.env.example`). One file is the single source of truth: the CLI scripts read it
via dotenv, and pm2 (step 4) captures it into the running app.

```bash
cd /root/codes/campusos
cat > .env <<'EOF'
# --- CampusOS production (VPS) ---
NODE_ENV=production
PORT=3003

# Local shared Postgres via the least-privilege app role (no SSL for localhost):
DATABASE_URL=postgres://campusos_app:PASTE_STRONG_PASSWORD_HERE@127.0.0.1:5432/campusos

# Real root domain so lgu.reivex.io resolves to the lgu tenant:
APP_DOMAIN=reivex.io

# Admin gate secret (enables /u/lgu/admin). Generate one and keep it secret:
#   openssl rand -hex 32
ADMIN_SECRET=PASTE_A_LONG_RANDOM_SECRET

# Deploy with the recorded fixture data now; the cron (step 7) refreshes live.
SOURCE_MODE=fixture
EOF
chmod 600 .env
```

Now finish step 2's migrate + seed (they need this `.env`).

---

## 4. Build and run under pm2 🟩 CAMPUSOS-LOCAL

Install, build, and start on port 3003 with the **Node 22** interpreter, without
disturbing your other pm2 apps.

```bash
cd /root/codes/campusos
nvm use 22
pnpm install --frozen-lockfile
pnpm turbo run build --filter=web     # next build; reads DB lazily, no DB needed

# Point pm2 at Node 22 for THIS app only (from `nvm which 22`):
export CAMPUSOS_NODE="$(nvm which 22)"

# Load the env so pm2 captures DATABASE_URL / ADMIN_SECRET / APP_DOMAIN, then start:
set -a; . ./.env; set +a
pm2 start ecosystem.config.cjs        # committed; runs apps/web via `next start -p 3003`
pm2 save                              # persist (captures the env + interpreter)
pm2 startup                           # only if pm2 boot-resurrect is not already set up;
                                      # run the command it prints. You already run pm2
                                      # apps, so this may already be configured.

pm2 logs campusos --lines 40          # confirm it booted and is listening on 3003
curl -sS -H 'Host: lgu.reivex.io' http://127.0.0.1:3003/u/lgu/timetable | head -c 300
```

**Production start command**: `next start` (via the committed `ecosystem.config.cjs`,
which runs `apps/web/node_modules/next/dist/bin/next start -p 3003` under
`$CAMPUSOS_NODE`). **Standalone output is not needed here** and is not enabled:
the repo is cloned with `node_modules` present, so `next start` runs directly.
(Standalone would trim the runtime footprint but needs `outputFileTracingRoot`
set for the monorepo; skip it unless you later want a smaller deploy.)

---

## 5. nginx + TLS 🟥 SHARED INFRA (your hands)

Matches your certbot-managed convention (as in `acc.reivex.io`): write a minimal
**port-80** `server_name` block, run `certbot --nginx`, and certbot rewrites it
into the `listen 443 ssl` block (with `options-ssl-nginx.conf` + `ssl-dhparam`)
and adds the port-80 -> 443 redirect. The only difference from your static vhosts
is that `location /` proxies to the app instead of serving files.

> **Critical for tenant routing**: the vhost MUST forward the real `Host` header
> (`proxy_set_header Host $host;`) or the app cannot resolve the `lgu` tenant, and
> that forwarded `Host` is what canonical/SEO URLs are built from. `X-Forwarded-Proto`
> keeps admin-login redirects on https. The app emits **relative** redirect
> `Location` headers, so it never leaks the upstream `127.0.0.1:3003`;
> `X-Forwarded-Host` is included for completeness but not required. The `Upgrade` /
> `Connection` headers pass websockets through (not needed by `next start` today,
> but future-proof and harmless).

First, add the websocket upgrade `map` once (http context). Skip if you already
have a `$connection_upgrade` map from another proxied app (the `grep` guards it):

```bash
grep -rqs 'connection_upgrade' /etc/nginx/ || sudo tee /etc/nginx/conf.d/websocket_upgrade.conf >/dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF
```

Create the minimal pre-certbot vhost `/etc/nginx/sites-available/lgu.reivex.io`:

```nginx
server {
    listen 80;
    server_name lgu.reivex.io;

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 60s;
    }
}
```

Enable, test, reload, then let certbot add TLS (same as your other vhosts):

```bash
sudo ln -s /etc/nginx/sites-available/lgu.reivex.io /etc/nginx/sites-enabled/lgu.reivex.io
sudo nginx -t                         # ALWAYS test before reload
sudo systemctl reload nginx

# DNS A record for lgu.reivex.io must already point at this VPS. Then:
sudo certbot --nginx -d lgu.reivex.io # rewrites the block to 443 + adds the redirect
sudo nginx -t && sudo systemctl reload nginx
```

After certbot, the `location /` proxy lives in the `listen 443 ssl` block and
`X-Forwarded-Proto` reports `https`, so app redirects stay on https. The
generated file will mirror your `acc.reivex.io` layout (443 block + a port-80
`return 301` block).

---

## 6. Map rooms 🟩 CAMPUSOS-LOCAL

Clear the `room=TBA` on the fixture data via the admin flow.

1. Visit `https://lgu.reivex.io/u/lgu/admin/login`.
2. Enter the `ADMIN_SECRET` from `.env`.
3. At `https://lgu.reivex.io/u/lgu/admin/rooms`, map each pending room (the
   default "Create a new room" named after the source string is one click each).
   `room=TBA` drops toward 0 as you go.

The mapping survives the next ingest (the sink self-heals via resolved aliases).

---

## 7. Autonomous refresh via cron 🟩 CAMPUSOS-LOCAL

This box is always on, so a cron replaces the `HOSTED_DB_ENABLED` GitHub workflow
(leave that workflow's repo variable unset; it stays off). `scripts/cron-ingest.sh`
loads Node 22 + `.env` and runs the full live crawl with the adapter's built-in
retry through the portal's flaky windows.

```bash
# Add to root's crontab: twice a day (03:00 and 15:00 UTC). `crontab -e`, then:
0 3,15 * * * /root/codes/campusos/scripts/cron-ingest.sh >> /var/log/campusos-ingest.log 2>&1

# Verify the script runs by hand once (it will attempt a LIVE crawl):
/root/codes/campusos/scripts/cron-ingest.sh 2>&1 | tail -20
```

The web app picks up refreshed data automatically (queries are `force-dynamic`);
no restart needed. Watch `/var/log/campusos-ingest.log` for anomaly counts.

> If the log shows "failed to mint PHPSESSID ... after retries" or many
> anomalies, the LGU portal is in a flaky window (see `docs/overnight/DECISIONS.md`);
> the next scheduled run retries.

---

## 8. Full-data backfill (later, when the portal is stable) 🟩 CAMPUSOS-LOCAL

One command pulls every semester × degree × section into the live DB:

```bash
cd /root/codes/campusos && nvm use 22
set -a; . ./.env; set +a
SOURCE_MODE=live pnpm ingest:lgu
```

Confirm it worked (last run succeeded, and entry/section counts grew):

```bash
sudo -u postgres psql -d campusos -c \
  "SELECT status, stats, finished_at FROM ingestion_runs ORDER BY started_at DESC LIMIT 1;"
sudo -u postgres psql -d campusos -c \
  "SELECT count(*) AS entries FROM timetable_entries WHERE valid_to IS NULL;"
```

Then map any new pending rooms (step 6). Once you are confident in live data, you
may flip `.env` `SOURCE_MODE=live` and `pm2 restart campusos`, but it is optional
— the cron already keeps the DB fresh regardless of the web app's mode.

---

## 9. Production smoke checklist

Run after step 5 (and again after step 6/8):

- [ ] `https://lgu.reivex.io` loads over TLS (valid cert, no warning).
- [ ] Tenant resolves from the real host: `https://lgu.reivex.io/u/lgu/timetable`
      renders the weekly grid (or `curl -H 'Host: lgu.reivex.io' https://lgu.reivex.io/u/lgu/timetable`).
- [ ] A section page renders and its **ICS feed returns 200**:
      `curl -sI https://lgu.reivex.io/u/lgu/sections/<id>/timetable.ics | head -1`.
- [ ] Admin gate blocks the unauthenticated: `https://lgu.reivex.io/u/lgu/admin/rooms`
      redirects to `/admin/login`, and
      `curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://lgu.reivex.io/u/lgu/admin/rooms/resolve`
      returns **401**.
- [ ] `https://lgu.reivex.io/robots.txt` and `/sitemap.xml` show the real domain.
- [ ] "Last updated" freshness line shows the latest ingest.
- [ ] `pm2 status` shows `campusos` online; `pm2 restart campusos` survives; a
      reboot brings it back (pm2 resurrect).
- [ ] RLS active: the app connects as `campusos_app` (`NOBYPASSRLS`), so it cannot
      read across tenants.

---

## Environment variables (VPS)

| Variable        | Value                                                  |
| --------------- | ------------------------------------------------------ |
| `NODE_ENV`      | `production`                                           |
| `PORT`          | `3003`                                                 |
| `DATABASE_URL`  | `postgres://campusos_app:<pw>@127.0.0.1:5432/campusos` |
| `APP_DOMAIN`    | `reivex.io`                                            |
| `ADMIN_SECRET`  | a long random secret (`openssl rand -hex 32`)          |
| `SOURCE_MODE`   | `fixture` now; the cron uses `live` regardless         |
| `CAMPUSOS_NODE` | (shell only, for `pm2 start`) the `nvm which 22` path  |

## Updating later

```bash
cd /root/codes/campusos && nvm use 22
git pull
pnpm install --frozen-lockfile
pnpm db:migrate:all                   # if a new migration landed
pnpm turbo run build --filter=web
pm2 restart campusos
```
