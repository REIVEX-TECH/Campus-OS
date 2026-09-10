# Overnight run 4 — morning report

Rides is now a complete module — the whole backend from Run 3 plus its entire web UI
(browse, post/request, seats, ratings, reports, a moderation queue, notifications, and
a signed share link). Campus map (Block C) has its foundation. Block D did the one
behavior-preserving shared-listings extraction that existing e2e can prove. Block E
(money movements) is built and **left unmerged for a human SQL review**, as instructed.

Every merged PR went through the normal loop: branch → PR → CI green → merge, one
level deep, off `main` (the Run-4 rule: never stack on an unmerged branch; the CI
waits were spent on design notes, tests, and docs). No gate was weakened; nothing was
merged red. Non-obvious calls are in `DECISIONS.md` (Run 4 sections).

Production was **not** touched: no migrations run, no deploy, no tenant flag flipped
in the DB. **Nothing was newly enabled for LGU.** `rides` and `campus-map` are both
live-capable modules that stay OFF in committed config.

Run 3's report is in git history; this supersedes it.

---

## 1. What shipped, by block

§6 = a concrete-SQL adversarial review applied (any PR adding/altering RLS, a
SECURITY DEFINER, or a privilege grant).

### Rides — the module is complete (flag `rides`, DISABLED everywhere)

| PR   | What                                                                                                                                                                          | §6      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| #224 | Lifecycle sweep (`auth_rides_sweep` owner definer) + `rides_next_occurrence` + script + runbook                                                                               | **yes** |
| #225 | Web UI-1: browse-by-day + filters, post/request forms, ride page, seat request + accept/decline, my rides; `rides` becomes a live flag-gated module                           | no      |
| #226 | Web UI-2: report control, rate forms on completed rides, `/rides/mod` queue, profile reputation, seat/cancel notification lines; `rides.moderate` added to the core catalogue | no      |
| #227 | Web UI-3: signed share link — `ride_share_tokens` (0005) + public `/r/[token]` page + create/copy/revoke                                                                      | **yes** |

Rides is feature-complete and CI-green. Enabling it for LGU is a one-line config
change (see §2), deliberately not made.

### Block C — campus map (module `packages/modules/campus-map`, flag `map`/`campus-map`, DISABLED)

| PR   | What                                                                                                                                                                                        | §6      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| #228 | Module scaffold + data model (`campus_maps`, `building_placements`, `map_pois`) + tenant RLS + read path; `map.manage` granted to the tenant_admin template and added to the core catalogue | **yes** |

Design: `docs/design-campus-map.md`. **C1 (foundation) is the run's deliverable; the
browse UI (C2) and admin editor (C3) are deferred** — the UI is browser-unverifiable
while the flag is off, and turning `map` into a live module now would churn the e2e
suite (`map` is the last "soon" stub the shell/modules/seo specs assert against, just
repointed there from rides). The review-critical core (schema, tenant RLS, permission)
is landed and integration-tested.

### Block D — shared-listings extraction (behavior-preserving)

| PR   | What                                                                                                                                                             | §6  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| #229 | Extract the byte-identical keyset-cursor codec (`PAGE_SIZE`/`encodeCursor`/`decodeCursor`/`toDate`) into `@campusos/db`; adopt in marketplace goods + L&F browse | no  |

Proven behavior-preserving by the existing marketplace browse e2e + both integration
suites. The moderation-surface and browse-card dedup is **not** taken — it is not
covered by existing e2e (only communities' report/remove flow is), so it can't be
proven "by existing e2e" as the brief requires; logged for a test-first PR.

### Block E — money movements (built, **UNMERGED**, `needs human SQL review`)

| PR   | What                                                                                   | §6      |
| ---- | -------------------------------------------------------------------------------------- | ------- |
| #230 | Finance anchor + payments/payouts/disputes + the money-moving definers + PayoutSecrets | **yes** |

See §3 for the SQL file paths and the reviewer's checklist. The seven design questions
are decided (`DECISIONS.md`, Block E); Q1 is the platform finance stamp per the
standing "finance grant, not tenant grant".

---

## 2. Enabling `rides` and `campus-map` (exact strings — NOT applied)

Both stay OFF. To enable, edit `tenants/lgu/tenant.config.ts` `enabledModules`.

- Today (unchanged in the repo):
  ```ts
  enabledModules: ['timetable', 'communities', 'lost-found', 'messages', 'marketplace'],
  ```
- To enable rides (after a human is ready; rides has a full UI):
  ```ts
  enabledModules: ['timetable', 'communities', 'lost-found', 'messages', 'marketplace', 'rides'],
  ```
- To also enable campus map — only once C2/C3 (its UI) ship; C1 alone has no page:
  ```ts
  enabledModules: ['timetable', 'communities', 'lost-found', 'messages', 'marketplace', 'rides', 'campus-map'],
  ```

The module registry key is `rides` and `campus-map` respectively. Rides also needs its
lifecycle sweep on cron (`pnpm rides:sweep`, `docs/runbooks/rides-sweep.md`) once live.

---

## 3. Block E — the unmerged PR and its SQL, for review

PR **#230** `feat(money): money movements` — branch `feat/money-movements`, label
**`needs human SQL review`**, CI green, **not merged**.

SQL files to review (adversarially, against the written SQL — CLAUDE.md §6):

- `packages/modules/money/drizzle/0001_finance_anchor.sql` — `platform_finance_uses`,
  `auth_begin_finance()`, `auth_finance_admin_for_txn()` (the platform finance stamp;
  the identity-0018 grant-use pattern).
- `packages/modules/money/drizzle/0002_finance_tables.sql` — `payments`, `payouts`,
  `disputes`; party-read RLS; all writes revoked from `campusos_app` by name.
- `packages/modules/money/drizzle/0003_finance_definers.sql` — the twelve definers:
  `pay_submit_receipt`, `payout_request`, `open_dispute` (self-service);
  `finance_confirm_payment`, `finance_reject_payment`, `finance_refund`,
  `finance_resolve_dispute`, `finance_mark_payout_paid`, `finance_reject_payout`
  (finance, stamp-gated); `money_release_internal` (owner-only, mechanical).

Supporting: `packages/modules/money/src/finance.ts` (TS surface),
`packages/modules/money/src/secrets.ts` (`PayoutSecrets` AES-256-GCM),
`.env.example` (`PAYOUT_ENCRYPTION_KEY`), and the `DEFINER_INTENT` additions in
`packages/modules/communities/test/communities.integration.test.ts`.

Reviewer's checklist (from the PR body): the split-dispute sum-to-zero; fee rounding
`(amount*1000)/10000`; each `md5(...)` txn_id's idempotency under a racing double-call;
`money_release_internal` being unreachable by the app (revoked by name); and whether
the platform-global stamp (Q1) is the right boundary. **Do not merge before this.**

Integration proof already in the PR: a raw app write to each finance table is refused;
confirm→escrow→release nets the fee; refund before/after release; a dispute split
balances; a payout holds then pays; a non-platform-admin is refused.

Deferred to the reviewed build (NOT in #230): the order↔money status wiring (editing
the live `mkt_order_transition`/`mkt_order_autocomplete`), the platform finance-admin
UI, and the production boot-assert of `PAYOUT_ENCRYPTION_KEY`.

---

## 4. Verification

- Every merged PR (#224–#229): CI green across `typecheck · lint · format · build ·
test`, `integration (Postgres + RLS)`, and `e2e smoke`. A first-run integration
  failure on #227 (a FORCE-table update via the migration role matched 0 rows — the
  documented split-DB trap) and on #228 (a no-actor read of tenant-scoped
  `role_permissions`) were fixed and re-run green; a timetable e2e flake on #228
  cleared on re-run.
- Local checks used throughout: `turbo run typecheck lint`, the web vitest suite
  (`no-dash`, migration-journal-parity, etc.), and the module integration suites
  against a real Postgres. Migrations that only fully assert under the split DB were
  applied locally to prove they parse, with the RLS/stamp assertions running in CI.

## 5. Follow-ups

- **Campus map C2/C3:** the Leaflet image-mode browse page + the accessible building/
  POI list, then the `map.manage`-gated admin editor (place/move pins, campus image via
  the ObjectStore seam). Do it when the flag can be exercised in a browser.
- **Block E integration** (the reviewer's, after §6): order↔money wiring, the finance
  admin UI, the `PAYOUT_ENCRYPTION_KEY` boot-assert.
- **Shared-listings, part 2:** a test-first extraction of the moderation surface
  (reportTarget/queue/dismiss/remove) and the browse cards.
- **Rides:** the recurring-offer creation form (backend + sweep already support it);
  rate-limit the public `/r/[token]` GET.
