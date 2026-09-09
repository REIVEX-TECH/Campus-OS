# Overnight run 3 — morning report

Block A (the leftovers) is finished and merged. Block B (rides) has its first three
PRs — the whole backend of the module — designed, built, tested, and merged. Every
PR went through the normal loop: branch → PR → CI green → merge. No gate was
weakened and nothing was merged red; `update-branch` was used where branch
protection required it. Non-obvious calls are in `DECISIONS.md` (Run 3 sections).

Production was **not** touched: no migrations run, no deploy, no tenant flag flipped
in the DB. Nothing was newly enabled for LGU.

**Read first:** the rides module is real but has **no web UI yet** — PRs 1-3 are the
backend (schema, RLS, read/write, seat requests, ratings), verified by integration
tests. Do **not** enable `rides` for LGU until the UI PRs land. Blocks C (campus
map), D (shared-listings extraction) and E (money movements) were not reached; each
has a design doc and is queued below.

---

## 1. What shipped, by block

§6 = a concrete-SQL adversarial review applied (any PR adding/altering RLS, a
SECURITY DEFINER, or a privilege grant).

### Block A — leftovers (COMPLETE)

| PR   | What                                                                                                                                                                                                                                                                                                           | §6        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| #213 | Services delivery files (attach on deliver, attachment-only download)                                                                                                                                                                                                                                          | yes (RLS) |
| #214 | Services reviews UI (buyer→seller, on gig + profile)                                                                                                                                                                                                                                                           | no        |
| #215 | Messages delete-for-me (per-participant `cleared_at`, reversible)                                                                                                                                                                                                                                              | no        |
| #216 | **Security M3**: role-definition writes behind a platform-admin stamp — `platform_admin_uses` + `auth_begin_platform_admin` + `auth_write_role_template`/`auth_set_role_template_permissions`/`auth_delete_role_template`; GUC-keyed write policies dropped, app table-writes revoked by name. identity `0033` | **yes**   |
| #217 | `scripts/backup-check.sh` — fails if newest dump missing or older than `MAX_AGE_HOURS` (default 26)                                                                                                                                                                                                            | no        |

(A1 tenant-editor drift banner and A2 notifications seam were merged earlier in the
run. Deferred + logged: marketplace-goods notification emitters; mutual
seller→buyer reviews.)

**M3 note:** during the §6 pass I hardened the migration beyond the first draft
(revoke the app's table-level writes by name, use the `FOUND` idiom over
`GET DIAGNOSTICS` into a boolean, pin the new table's FORCE state in the invariants
test) and fixed a real defect the CI integration suite caught — the permissions
array must be built as a `text[]` literal (`array[...]::text[]`), because Drizzle
expands a bare JS array into a parameter list. Verified against a real Postgres.

### Block B — rides (module `packages/modules/rides`, flag `rides`, DISABLED everywhere)

Design: `docs/design-rides.md` (5-PR plan).

| PR   | What                                                                                                                                                                                                                                            | §6        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| #218 | Backend: `ride_posts` (offers w/ seat ledger, requests) + tenant/FORCE RLS + insert-as-self + browse (filters, keyset, blocked-author hidden both ways) + create/edit/cancel (verified, seat cap, future departure, contact-info scrub). `0000` | yes (RLS) |
| #219 | `ride_seat_requests` + request/accept/decline/cancel (driver acts on own ride, atomic no-oversell seat decrement) + notifications. `0001`                                                                                                       | yes (RLS) |
| #220 | `ride_ratings` + `auth_rides_submit_rating` definer (rating integrity: pairing re-verified against the completed ride + accepted seat requests as owner; app has no INSERT). `0002`                                                             | **yes**   |

15 rides integration tests, all green in CI. The ratings definer passes the
communities DEFINER_INTENT audit.

## 2. Not done — remaining work (priority order; each is fully specified)

1. **Rides PR 4 — safety**: `ride_reports` + moderation queue (`rides.moderate` →
   tenant_admin, mirroring L&F `0002`) + report-threshold hide + signed share-link
   (`ride_share_tokens` + a public read-only trip page).
2. **Rides PR 5 — lifecycle**: `pnpm rides:sweep` (auto-complete 2h after departure,
   expire un-ridden, spawn next recurrence through the tenant timezone) + runbook + cron.
3. **Rides UI** — every page (browse grouped by day, post form, ride detail + seat
   requests, my rides/requests, moderation queue, ratings on profile, "where is this"
   map links). None built yet.
4. **Rides → messages** system-conversation on seat-accept (deferred; notify-only
   shipped, the design's graceful-degradation path).
5. **Block C — campus map** (NOT started; design doc `docs/design-campus-map.md` not
   yet written): Leaflet + OSM tiles, building lat/lng, tenant-admin pin editor
   (`campusmap.manage`), public map page, free-rooms-now, "where is this" links.
6. **Block D — shared-listings extraction** (NOT started): behavior-preserving only,
   gated on L&F + marketplace e2e passing unchanged.
7. **Block E — money movements — BUILD, DO NOT MERGE** (NOT started):
   `docs/design-money-movements.md` Block 4. Q1 decided: a dedicated platform
   **finance** grant (same mechanics as the tenant grant), not the tenant grant. Open
   PRs, get green, leave unmerged with a "needs human SQL review" label. (No Block E
   PRs exist yet, so there is no unmerged-PR list this run.)

## 3. Enable for LGU

- **`rides`: not yet.** Backend only; no UI. Enable (file `enabledModules` +='rides',
  then the DB row via the tenant editor) after the rides UI PRs land.
- **`campus-map`: not built.**

## 4. Crons to add

```cron
# backup freshness (A6), a few hours after the nightly dump:
0 8 * * * cd /srv/campusos && BACKUP_DIR=/srv/campusos-backups ./scripts/backup-check.sh >> /var/log/campusos/backup-check.log 2>&1
# rides sweep — PENDING (rides PR 5): pnpm rides:sweep --tenant <slug>
```

## 5. Env vars

No new env vars this run.

## 6. Verification SQL (new tables / definers)

```sql
-- M3 platform-admin stamp (identity 0033): RLS on, NO FORCE, app cannot touch it.
select relrowsecurity, relforcerowsecurity from pg_class where relname='platform_admin_uses'; -- (t,f)
select has_table_privilege('campusos_app','platform_admin_uses','select');                    -- f (split)

-- M3 definers exist and are app-executable:
select proname, has_function_privilege('campusos_app', p.oid, 'execute') as app_exec
from pg_proc p where proname in
 ('auth_begin_platform_admin','auth_platform_admin_for_txn','auth_write_role_template',
  'auth_set_role_template_permissions','auth_delete_role_template');                            -- all t

-- rides tables + FORCE:
select relname, relrowsecurity, relforcerowsecurity from pg_class
where relname in ('ride_posts','ride_seat_requests','ride_ratings') order by relname;
--   ride_posts (t,t) | ride_ratings (t,f) | ride_seat_requests (t,f)

-- rides ratings: definer app-executable, app cannot INSERT the table directly:
select has_function_privilege('campusos_app','auth_rides_submit_rating(uuid,uuid,integer,text,text)','execute'); -- t
select has_table_privilege('campusos_app','ride_ratings','insert');                            -- f (split)
```

## 7. Browser checklists (once the rides UI lands; the backend is integration-tested now)

- **Student**: /u/lgu/rides — browse offers/requests grouped by day, filter women-only,
  search a route; a blocked person's rides are absent.
- **Driver**: post an offer (contact info in notes is refused), see incoming requests,
  accept (seat count drops; full at zero) / decline; cancel a ride (riders notified).
- **Passenger**: request a seat, watch status change, cancel an accepted seat (seat
  returns); after completion, rate the driver 1-5.
- **Admin** (rides PR 4): open the rides moderation queue, remove a reported ride.

## 8. Notes

- Rides tests are split-DB integration tests (CI is the gate; the local
  `campusos_test` is split too, so 15/15 ran locally).
- Local-only flake: the communities `karma … caps how far one account can move
another` test fails on the polluted local `campusos_test` (it fails on `main` too,
  unrelated to this run) — green in CI.
- Toolchain: the nvm/corepack hang workaround (cached `pnpm.cjs` via node with
  `COREPACK_ENABLE_NETWORK=0`) was used throughout; CI is authoritative.
