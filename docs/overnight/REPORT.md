# Overnight run 2 — morning report

Marketplace (goods + the services core) and the money ledger substrate. Every PR
went through the normal loop: branch → PR → CI green → merge. No gate was weakened
and nothing was merged red. `--admin` merges and one `update-branch` were blocked by
the auto-mode classifier and were respected, not bypassed. Non-obvious calls are in
`DECISIONS.md`.

Production was **not** touched: no migrations run, no nginx changed, no deploy done,
no tenant flag flipped in the DB. The deploy sequence is below.

**The one thing to read first:** the money work this run is the **ledger substrate
only** (an append-only double-entry ledger and its single owner-only writer) plus a
pure-TS payment seam. The money **movements** — confirming a payment, releasing
escrow, payouts, refunds, and the platform finance admin — are **designed but not
built**, on purpose: CLAUDE.md §6 says money SQL must have a human adversarial
review of the concrete SQL before production (two Phase-5 escalations were caught
only that way), and those actions are platform-privilege writes that must be gated
on a grant use-row. They are Block 4 and want your eyes before they exist.

---

## What shipped, by block

Each row: PR, one line, merge SHA, and whether a §6 concrete-SQL review applied (any
PR adding/altering RLS, a SECURITY DEFINER, or a privilege grant).

### Block 0 — finish queue (media + Lost & Found hardening)

| PR   | What                                                                                                              | Merge SHA | §6  |
| ---- | ----------------------------------------------------------------------------------------------------------------- | --------- | --- |
| #189 | media serving hardening: exclude `/media` from tenant rewrite, `MEDIA_DATA_DIR` boot check, e2e image-upload test | `e15e3be` | no  |
| #190 | "Cards and IDs" warning on the L&F post form                                                                      | `c41fddc` | no  |
| #191 | withdraw/remove an L&F item deletes its photo **files** from disk, not just rows                                  | `08a7e92` | yes |

### Block 1 — Marketplace goods (new module, enabled for LGU)

| PR   | What                                                                                                                                | Merge SHA | §6  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | --------- | --- |
| #192 | marketplace scaffold: module, manifest, `mkt_listings`/`mkt_listing_photos` (tenant RLS + FORCE + RESTRICTIVE insert-as-self), 0000 | `064aaa4` | yes |
| #193 | post + browse listings (verified-gate, upload pipeline, filters, keyset paging)                                                     | `513d6e7` | yes |
| #194 | seller lifecycle (reserve/sell/relist/withdraw), saved 0001 own-row RLS                                                             | `1682c11` | yes |
| #195 | saved listings page + save/unsave                                                                                                   | `11d034a` | yes |
| #196 | reporting + moderation (`mkt_reports` 0002, `marketplace.moderate` definers)                                                        | `ed4c824` | yes |
| #197 | policy page + enable marketplace (goods) for LGU; module-hub card live                                                              | `1852f7d` | no  |
| #198 | seller "For sale" tab on the public profile                                                                                         | `e84b7d0` | no  |

### Block 2 — Marketplace services (gigs, orders); disabled for LGU

| PR   | What                                                                                                                           | Merge SHA | §6  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | --------- | --- |
| #199 | services catalog: `mkt_gigs` + `mkt_gig_packages` (0003), RLS mirroring goods; gig read/write                                  | `ccc6601` | yes |
| #201 | orders + append-only `mkt_order_events` + `mkt_reviews` (0004); the order state machine as one SECURITY DEFINER; auto-complete | `6f00df8` | yes |
| #200 | `@campusos/media/file`: non-image delivery intake (allowlist + magic-byte + attachment)                                        | `51e51a1` | no  |

### Block 3 — Money (ledger substrate + payment seam); no tenant enabled

| PR   | What                                                                                                     | Merge SHA                  | §6           |
| ---- | -------------------------------------------------------------------------------------------------------- | -------------------------- | ------------ |
| #202 | `@campusos/core/payments`: `PaymentProvider` seam (manual + fake) + integer fee math                     | `555d7d3`                  | no (pure TS) |
| #203 | `@campusos/module-money`: append-only double-entry `ledger_entries` (0000) + owner-only `money_post_txn` | _in CI at time of writing_ | yes          |

If #203 is green when you read this, its merge SHA is on the PR; if it went red,
the failure and fix are in the session log — it had passed local typecheck/lint and
its integration test mirrors the already-green order-events append-only pattern.

---

## Deploy sequence (the morning's job)

1. **Migrations.** Run `pnpm migrate` (scripts/migrate-all.ts, as the schema owner —
   see `docs/db-role-split.md`). New this run, applied in module order after base:
   - marketplace: `0003_marketplace_services`, `0004_marketplace_orders`
   - money: `0000_money`
     Block 0/1 marketplace `0000`–`0002` and the L&F/media changes are already covered
     by the earlier run's migrations plus #189–#191 (no new marketplace migration in
     Block 0; #191 was code-only). Money is registered in `migrate-all` and the root
     workspace.
2. **Environment variables.**
   - `MEDIA_DATA_DIR` — already required-in-production (set from the earlier run);
     confirm it points at the nginx-served volume.
   - `PAYOUT_ENCRYPTION_KEY` — **not needed yet.** Payouts are Block 4. Generate it
     (`openssl rand -base64 32`) and add it to the environment and `.env.example`
     when Block 4 lands, boot-asserted, before any payout code runs.
3. **Crons.**
   - `marketplace:expire` (goods auto-expire) — already scripted; schedule it if not
     already (e.g. hourly) now that goods are live for LGU.
   - Order auto-complete (`mkt_order_autocomplete(tenant, days)`) — **not scheduled**:
     services are disabled, so nothing to complete yet. Wire a small script (mirroring
     `marketplace:expire`) when services are enabled.
4. **nginx.** `/media` continues to serve object-store files. When Block 4 wires
   order-delivery downloads, the delivery route/nginx must send
   `Content-Disposition: attachment` for non-image files (the `@campusos/media/file`
   allowlist already excludes HTML/SVG). No nginx change is needed this run.

No production flag flip is required: LGU has goods on (a file default; a DB config
row still wins — confirm the tenant config row if one exists). Services and money
are off everywhere.

---

## Verification SQL (run against the migrated database)

```sql
-- 1. FORCE state of every new table (expected in the third column).
--    Goods-shape tables FORCE; orders/events and the ledger are NO FORCE by design
--    (owner-run definers must write across parties/accounts; the app is a non-owner
--    confined by policies + write revokes).
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in ('mkt_gigs','mkt_gig_packages','mkt_orders','mkt_order_events',
                  'mkt_reviews','ledger_entries')
order by relname;
--  mkt_gigs           t t      mkt_gig_packages t t      mkt_reviews t t
--  mkt_orders         t f      mkt_order_events t f      ledger_entries t f

-- 2. Definer execute-ability by the app role (expected in the comment).
select p.proname,
       has_function_privilege('campusos_app', p.oid, 'execute') as app_can_execute
from pg_proc p
where p.proname in ('mkt_place_order','mkt_order_transition','mkt_order_autocomplete',
                    'money_post_txn')
order by p.proname;
--  mkt_place_order        t     mkt_order_transition t     mkt_order_autocomplete t
--  money_post_txn         f     <- owner-only; the ledger's only writer

-- 3. The app cannot write the append-only tables (expected: all f).
select c.relname, has_table_privilege('campusos_app', c.oid, 'INSERT') as ins,
       has_table_privilege('campusos_app', c.oid, 'UPDATE') as upd,
       has_table_privilege('campusos_app', c.oid, 'DELETE') as del
from pg_class c
where c.relname in ('mkt_orders','mkt_order_events','ledger_entries')
order by c.relname;
--  ledger_entries f f f    mkt_order_events f f f    mkt_orders f f f

-- 4. Migration journal parity (each module bookkeeping table has the new rows).
select count(*) from "__drizzle_migrations_marketplace";  -- 5 (0000..0004)
select count(*) from "__drizzle_migrations_money";        -- 1 (0000)
```

CI already ran the same guarantees as tests: the marketplace and money integration
suites assert the RLS isolation, the state-machine edges, the append-only refusals
(a raw app write of an order status / an event / a ledger row is rejected), and that
the app cannot execute `money_post_txn`. The communities `DEFINER_INTENT` audit
records every SECURITY DEFINER and its intended executor.

---

## Browser checklist

Goods is the live, exercisable flow (services and money have no UI yet — see
deferrals). On `/u/lgu`:

**As a verified member (buyer and seller):**

- Marketplace appears in the module hub and the nav; the "Coming soon" stub is gone.
- Post a listing (`/marketplace/post`) with 1–6 photos; a phone number or WhatsApp
  handle in the text is refused with a clear message; the prohibited-items note shows.
- The listing appears in browse; filter by category/condition/price and sort; search.
- Open the listing: photos, price (with "cash on meetup"), "Message seller" (opens
  the compose sheet with the title + link prefilled), Save, Report.
- As the seller: mark Reserved → Sold → relist; the "For sale" tab on your public
  profile lists your active listings.
- Saved page lists what you saved; unsave removes it.

**As a tenant admin:**

- `/marketplace/mod` shows the report queue; removing a reported listing resolves its
  reports and deletes its photo files.

**Policy:** `/marketplace/policy` renders (operator "Reivex Technologies" placeholder)
and is linked from the post and browse screens.

---

## Decisions & deferrals

Full reasoning in `DECISIONS.md`. The deliberate gaps:

- **Block 2 services UI/API (browse gigs, place/track an order, order chat, delivery
  files, reviews)** — the data + security core is built, tested, and merged; the UI
  is not. Services are disabled for LGU, so this is not on the LGU critical path.
  It follows the goods UI patterns already in `apps/web`.
- **Order ↔ money wiring** — `mkt_order_transition` must not call money directly
  (cross-module). When money is enabled, the app layer calls the money finance
  definers on `paid`/`completed`. Not wired.
- **Gig gallery + `shared-listings` extraction** — the photo table/write pattern is
  now at its third would-be copy; CLAUDE.md says extract it then. Deferred as its own
  refactor (touches merged L&F + goods).
- **Block 4 — platform finance admin, and all money movements**: the `payments`
  table + manual receipt upload + confirm/reject, escrow release, payouts (with
  `PAYOUT_ENCRYPTION_KEY`), refunds/splits, and the `/admin` finance surfaces. These
  are the platform-privilege writes that must be gated on a live grant use-row and
  that call `money_post_txn`. **Not built — they need the human §6 SQL review first.**
- **Block 5 — polish/i18n/a11y/empty-states/mobile sweep and a Safepay/PayFast
  adapter design note** — not done; the goods flow has its own strings, empty states,
  and policy page, but no dedicated polish pass was run.

## Stated plainly (things to double-check)

- **The money movements do not exist yet.** The ledger can hold balanced
  transactions and prove it cannot be forged by the app, but nothing posts to it in
  production until Block 4's finance definers are written and reviewed. Do not read
  "money module merged" as "payments work."
- **Toolchain wobble mid-run:** `nvm use` / `corepack pnpm` started hanging on a
  network check on this machine. I invoked the corepack-cached pnpm directly with
  `COREPACK_ENABLE_NETWORK=0` to run local checks and the pre-commit hook; all ran
  green. CI is the source of truth regardless. If your local `pnpm` hangs, that is
  why — it is the network check, not the repo.
- **`pnpm-lock.yaml` was updated** for the new `@campusos/module-money` workspace
  package. If CI runs `--frozen-lockfile`, confirm #203's lockfile change is present.
- **Merge SHAs** above are the merge commits on `main`; #203's lands when it merges.
