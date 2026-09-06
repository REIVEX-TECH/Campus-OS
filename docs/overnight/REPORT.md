# Overnight run — morning report

Every PR went through the normal loop: branch → PR → CI green → merge. No gate was
weakened and nothing was merged red. Non-obvious calls are in `DECISIONS.md`; new
security findings (none live) would be in `SECURITY-BACKLOG.md`.

Production was **not** touched: no migrations were run, no nginx changed, no deploy
done. That is the morning's job — the exact sequence is below.

---

## What shipped, by block

Each row: PR, one line, merge SHA, and whether a §6 concrete-SQL review ran (any
PR adding/altering RLS, a SECURITY DEFINER, or a privilege grant).

### Block 1 — Lost & Found (new module, enabled for LGU)

| PR   | What                                                                      | Merge SHA | §6  |
| ---- | ------------------------------------------------------------------------- | --------- | --- |
| #151 | media/object-store seam (`packages/media`, `ObjectStore`, sharp pipeline) | `12571fa` | n/a |
| #152 | lost-found scaffold + model + browse (items/photos, tenant RLS + FORCE)   | `b6fd27a` | yes |
| #153 | post an item (verified-gate, upload: magic-byte + sharp + thumbnail)      | `74a9093` | yes |
| #155 | claims lifecycle + private claim threads (participant RLS, NO FORCE)      | `6e661c1` | yes |
| #156 | reporting + moderation (`lf_reports`, `lostfound.moderate` definers)      | `0f6575b` | yes |
| #157 | browse filters, 90-day auto-expiry, enable for LGU                        | `4e3cb00` | no  |

### Block 1.5 — Identity governance

| PR   | What                                                                                                                           | Merge SHA | §6  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | --------- | --- |
| #147 | contain the platform exemption in `auth_set_membership_role` to a live grant (0029)                                            | `b1ae188` | yes |
| #148 | move verification PII to `verification_request_details`, own-row RLS + purge (0030)                                            | `89b636e` | yes |
| #149 | composed-review Lows + doc rewrite                                                                                             | `e5c09ff` | yes |
| #150 | security backlog doc                                                                                                           | `6ad01ac` | n/a |
| #158 | **1.5a** admin can reveal a member's identity (`tenant_member_identity`, `auth_member_identity`, `view-member-identity`, 0031) | `99820ea` | yes |
| #160 | **1.5b** only platform admins assign tenant roles (drop `manage-roles` from tenant_admin, add it to the grant branch, 0032)    | `93c8adf` | yes |

### Block 2 — Public profiles + karma

| PR   | What                                                                                                          | Merge SHA | §6                |
| ---- | ------------------------------------------------------------------------------------------------------------- | --------- | ----------------- |
| #161 | richer profile (member-since, Admin badge, karma split, Edit link, handle links) + a post-history privacy fix | `6ec3aaf` | no (query filter) |

### Block 3 — Direct messages (new module, NOT yet enabled)

| PR   | What                                                                               | Merge SHA | §6  |
| ---- | ---------------------------------------------------------------------------------- | --------- | --- |
| —    | design docs (`docs/design-messages.md`, `docs/design-calls.md`)                    | (in #162) | n/a |
| #162 | module core: conversations/messages, participant RLS, send/read/edit/delete (0000) | `9627dcd` | yes |
| #163 | moderation: report-with-snapshot + `messages.moderate` definers (0001)             | `eaf6f0e` | yes |

> The messages module backend is complete and CI-green, but has **no UI and is
> enabled for no tenant** — see "Not done" below.

---

## Deploy sequence (run in this order)

The last production deploy was "through #149" (0029/0030 already applied). So the
new work to apply is: identity 0031–0032, all of lost-found, and messages.

### 1. Pull + install + build

```bash
cd /srv/campusos
git pull            # main at #162/#163
pnpm install --frozen-lockfile
pnpm build
```

- **sharp native binary check** (Lost & Found photos, Ubuntu 24.04): confirm the
  Linux binary resolved, else photo processing throws at runtime.

```bash
node -e "require('sharp'); console.log('sharp ok', require('sharp').versions)"
ls node_modules/@img | grep sharp-linux-x64
```

### 2. Environment

Add to the repo-root `.env` (documented in `.env.example`, `apps/web/lib/app-env.vars.json`):

```
MEDIA_DATA_DIR=/srv/campusos-data/media
```

- `MEDIA_DATA_DIR` is where Lost & Found photos are written (UUID keys). It is
  **optional** to boot, but Lost & Found photo upload fails without it.

### 3. Data directory (outside the repo)

```bash
sudo mkdir -p /srv/campusos-data/media
sudo chown <the-app-user>:<the-app-user> /srv/campusos-data/media
sudo chmod 750 /srv/campusos-data/media
```

Full detail: `docs/runbooks/media-storage.md`.

### 4. Migrations (as the owner role)

```bash
pnpm db:migrate:all      # base + every module, each its own bookkeeping table
```

New migrations this applies (in module order): identity `0031_member_identity`,
`0032_platform_only_role_grants`; lost-found `0000_lost_found`,
`0001_lost_found_claims`, `0002_lost_found_moderation`; messages `0000_messages`,
`0001_messages_moderation`.

### 5. Re-apply db-grants (the role split re-run)

```bash
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db-grants.sql
```

This re-grants table DML + non-definer EXECUTE to `campusos_app` for the new
tables/functions and (harmlessly) re-affirms the definer exclusions. It never
opens an owner-only definer (the DEFINER_INTENT test proves the exclusion holds).

### 6. nginx (Lost & Found photos)

Add the media location block from `docs/runbooks/media-storage.md` so photos are
served by nginx from `MEDIA_DATA_DIR` with a long immutable cache (the Next route
is dev-only):

```nginx
location /media/ {
    alias /srv/campusos-data/media/;
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`.

### 7. Cron

Lost & Found auto-expiry (daily is plenty), from `docs/runbooks/lost-found-expire.md`:

```cron
20 3 * * * cd /srv/campusos && pnpm lostfound:expire -- --tenant lgu >> /var/log/campusos/lostfound-expire.log 2>&1
```

(Messages has **no** cleanup cron yet — ephemerality is not built; see "Not done".)

### 8. Reload the app

```bash
pm2 reload campusos       # or the process name in ecosystem config
```

---

## Post-deploy verification (SQL, as owner unless noted)

### FORCE state of the new tables

```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in (
  'tenant_member_identity',        -- expect rowsecurity=t, force=f (definer reads it)
  'lf_items','lf_item_photos',     -- force=t
  'lf_claims','lf_claim_messages', -- force=f (moderator definer)
  'lf_reports',                    -- force=f
  'msg_conversations','msg_participant_state','msg_messages', -- force=f
  'msg_reports'                    -- force=f
) and relkind='r' order by relname;
```

Every one must have `relrowsecurity = t`. FORCE (`relforcerowsecurity`) is `f`
exactly where a definer reads across (identity/messages/claims/reports) and `t`
on `lf_items`/`lf_item_photos`.

### App EXECUTE on the new definers

```sql
select p.proname, has_function_privilege('campusos_app', p.oid, 'execute') as app_can_execute
from pg_proc p
where p.pronamespace='public'::regnamespace and p.prosecdef
  and p.proname in ('auth_member_identity','auth_lf_report_queue','auth_lf_resolve_reports',
                    'auth_msg_report_queue','auth_msg_resolve_reports')
order by p.proname;
```

All five must be `app_can_execute = t` (they self-gate on a permission inside).
`auth_effective_permissions` stays `t` (re-defined in 0032, still app-callable).

### Journal parity / migrations recorded

```sql
select left(id,60) from public.__drizzle_migrations_messages order by created_at;   -- 0000, 0001
select left(id,60) from public.__drizzle_migrations_identity order by created_at;   -- ... 0031, 0032
-- lost-found records in __drizzle_migrations_lost_found: 0000..0002
```

### manage-roles is off the resident tenant_admin (0032)

```sql
select exists(select 1 from role_template_permissions
              where template_key='tenant_admin' and permission='manage-roles') as resident_has_manage_roles;
-- expect: f
```

---

## Browser checklist

- **Lost & Found** (`/u/lgu/lost-found`): browse with lost/found + open/resolved
  tabs, category + search filters; post an item (verified account) with a photo →
  the thumbnail serves from `/media/`; open an item, claim it, message the poster,
  poster confirms → item resolves; a moderator sees the queue at `/lost-found/mod`;
  My items shows "expiring soon" + "Keep it listed" near a due item.
- **Admin identity reveal** (`/u/lgu/admin/members`): a tenant admin sees "Show
  identity"; clicking reveals name/roll/sign-in-email; a domain-verified member
  shows just the email; confirm an `member.identity_viewed` audit row per reveal.
- **Platform-only roles** (`/u/lgu/admin/roles`): as a resident admin the page is
  read-only (catalogue + a note), no grant control; the members page shows no role
  chips; only a platform admin under a grant can assign roles.
- **Profiles** (`/u/lgu/people/<handle>`): Admin badge, "Member since <Month
  Year>", karma total + split; own profile shows "Edit profile"; a member's post
  in a restricted community does not appear; handles in a community's members list
  and the moderators rail link to the profile.
- **Messages**: backend only — no page yet.

---

## Decisions & deferrals

`docs/overnight/DECISIONS.md` has the full log (Blocks 1, 1.5a, 1.5b, 2, 3). The
larger deferrals, all logged:

- **`docs/SECURITY-BACKLOG.md`**: whether `view-member-identity` should be
  resident-only (excluded from the grant branch); M2 standing/appeal side-table;
  the standing-reason-in-audit Low.
- **Shared notifications + reports concern (core)**: L&F and messages both keep
  their own reports tables and surface activity in-module, because a module must
  not write another's tables (§4). A core notifications/reports seam is the
  flagged right answer; until then, cross-module push notifications are deferred.

## Not done (the remaining messages work — safe to pick up in the morning)

The messages **backend is complete and CI-green** (core + moderation, both §6),
but the feature is **not enabled for any tenant** and has **no UI**. Remaining, in
order, before flipping LGU on (§8 wants reporting + blocking + moderation all
present at enablement):

1. **UI** — inbox (`/u/lgu/messages`) + thread (`/messages/[id]`): composer with
   optimistic send, 3s thread / 15s inbox polling, read receipts, edit/delete
   controls, a report control ("Reporting saves a copy for moderators"), the
   sidebar unread count, and the **Message button on the profile** (Block 2
   deferred it here). Web wiring: `apps/web/lib/messages.ts`, a `messages-route.ts`
   gate, the `apps/web/lib/modules.ts` nav card, and the JSON routes.
2. **Blocks honored** — composed at the route via communities' block check
   (sender-side is straightforward; the bidirectional "recipient blocked you"
   refuse needs a shared block definer — flag it).
3. **Ephemerality + cleanup** — `after_24h` / `after_viewing` (first-view stamping
   needs a small definer or narrow policy) + delete-for-me + a 15-min hard-delete
   cron (`scripts/cron-messages-cleanup.sh`) + runbook. Schema columns are already
   reserved (`expires_at`, `first_viewed_at`, `cleared_at`).
4. **Enable for LGU** — add `'messages'` to `enabledModules` once 1–3 are in.

Nothing tonight failed silently; the only CI hiccups were self-inflicted and
fixed in-loop (a DEFINER_INTENT registry entry, an order-independent test-DB
migration application, a FORCE-table test-setup path, a couple of em-dash copy
lint failures, and a recipient-unread query). One e2e flake (a timetable term
combobox) passed on re-run.
