# feat(lost-found): browse filters, auto-expiry, and enable for LGU

Lost & Found PR 5 — the polish pass, and the module goes live for LGU. No RLS,
no SECURITY DEFINER, and no privilege grant change: extend and expire are plain
updates under the policies PR 2–4 already set. (§6 not required.)

## What

- **Enable for LGU.** `tenants/lgu/tenant.config.ts` adds `lost-found` to
  `enabledModules`. Enablement is a tenant config change (§4), flipped live on
  the morning deploy; no core change.
- **Browse filters, all URL state.** The browse page gains a status toggle
  (open / resolved), a category select, and a free-text search, alongside the
  existing lost / found tabs. Every filter is a query param carried through the
  tabs and the keyset "more" cursor; the search + category form is a plain GET.
  The page stays a Server Component, so filters are shareable and
  back-button-correct.
- **Auto-expiry (90-day default).** An open item is stamped with `expires_at` at
  post time from the tenant's `expiryDays`. A scheduled sweep,
  `expireOpenItems(tenant)`, flips overdue open items to `expired`: they leave
  the default browse list but stay viewable by direct link and in My items.
  `pnpm lostfound:expire -- --tenant lgu` from cron (see the runbook). The sweep
  runs with no actor in the tenant context and rides the permissive tenant
  policy, exactly like the communities archive sweep; it is idempotent.
- **"Expiring soon" + one-tap extend.** My items flags an open item within 7 days
  of expiry (computed live from `expires_at`, so it does not depend on the sweep)
  and offers **Keep it listed**, which pushes `expires_at` out by another full
  window and clears the notify mark. Reporter-only, open-only.

## Notify — deferred honestly

The design's "notify 7 days before" is surfaced in-app (the live badge), not as a
push/email: cross-module notifications stay deferred with the shared
notifications concern (§4, `docs/overnight/DECISIONS.md`). `expiry_notified_at`
is reserved for that reminder's idempotency.

## Data & migration impact

**No schema change.** `expires_at` / `expiry_notified_at` already exist (0000).
No migration.

## Tests

`lost-found.integration.test.ts` gains an expiry suite (split DB): the sweep
expires only overdue open items (out of browse, still owned as `expired`) and is
a no-op on a second run; an item within the window is flagged `expiringSoon`;
only its reporter can extend it (window pushed out, flag clears); a
withdrawn/resolved item does not extend.

```bash
pnpm -C packages/modules/lost-found test:integration
```

## Verification

```bash
pnpm --filter web build        # browse filters + My items compile
pnpm lostfound:expire -- --tenant lgu   # dry the sweep against a dev DB
```

- `/u/lgu/lost-found` — lost/found tabs, open/resolved toggle, category select,
  search box; each carries into the "more" link.
- `/u/lgu/lost-found/mine` — an item inside 7 days shows "Expires <date>" and
  **Keep it listed**; tapping it clears the badge.

## Ops

New runbook `docs/runbooks/lost-found-expire.md`: what the sweep does, the cron
line (one per enabled tenant), and rollback (there is nothing destructive —
`open → expired`, reversible by extend).

## Follow-ups

- Grant-based moderation threading (carried from PR 4b).
- Shared notifications concern (core) unlocks the real expiry reminder and claim
  notifications.
