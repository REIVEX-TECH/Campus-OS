# fix(identity): contain the platform exemption in auth_set_membership_role to a live grant

A composed §6 review of the whole identity module (grant + seam + join policy +
find-by-email + verification + prefs, reviewed as one system rather than
per-PR) found one High: `auth_set_membership_role` was the only privileged-write
definer that authorized platform-admin power on a **bare `platform_roles` read
keyed on `app.user_id`**, off-grant, instead of the unforgeable grant use-row its
five siblings use. That is the exact pattern CLAUDE.md §8 forbids, and it broke
the resolver's own codified invariant — "a platform admin with no use row for
this transaction resolves to nothing" (0018).

## The hole

In `auth_set_membership_role` (0019):

- the self-target refusal fired only `IF v_grant_admin IS NOT NULL` — **skipped
  off-grant**;
- `v_from_platform` read `platform_roles` directly for `app.user_id`, with no
  requirement that a grant be live;
- that flag bypassed both the `manage-roles` requirement and the `above_own`
  ("no power above your own") check.

So, off-grant, a platform-admin context could `auth_join_as_student(victim)` and
then `auth_set_membership_role(victim, self, 'tenant_admin', true)` to
self-escalate into a real `tenant_admin` membership of **any** tenant — or install
any role (including a `communities.unmask`-bearing one) on any member —
un-attributable to any grant (NULL grant id in the audit row).

Through the shipped UI this was blocked at the app layer (`tenantWriteContext`
refuses a platform admin with no live grant), so it was not live in production —
but CLAUDE.md §4 is explicit that the app layer is never the security guarantee,
and this is the third instance of exactly the §8 class the project has been
burned by.

## The fix (migration 0029)

`CREATE OR REPLACE auth_set_membership_role` so the platform exemption is
reachable **only under a live grant**, decided on the **unforgeable** grant admin
(`auth_grant_admin_for_txn()`, read from the use-row), never `app.user_id`:

```sql
v_from_platform := v_grant_admin IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform_roles pr WHERE pr.user_id = v_grant_admin AND pr.role = 'platform_admin'
);
```

Off-grant, `v_grant_admin` is NULL, the exemption is unreachable, and a platform
admin resolves to nothing in a tenant they do not reside in — self-escalation and
off-grant role installation are both closed at the database. Under a grant the
self-target refusal already applied, so `communities.unmask` assignment survives,
now scoped to an audited, expiring, single-tenant grant. This also settles the
review's related Medium (a grant visitor spreading unmask): unmask assignment is,
and remains, a platform power — now exercised only through an audited grant.

## Data & migration impact

Migration `0029_set_membership_role_grant_containment.sql` replaces one
app-callable definer in place; same signature, so its EXECUTE grant and the
`DEFINER_INTENT` classification are preserved. No table or data change. Journal
entry `idx 29` added. **No production behavior change**: `tenantWriteContext`
already required a live grant before this definer was reached, so the app never
called this path off-grant — this makes the database enforce what the application
already enforced. Rollback: re-apply the 0019 body (not recommended — it reopens
the hole).

## Tests

`packages/modules/identity/test/isolation.integration.test.ts`:

- rewrote the `trust-office` / `communities.unmask` case: a resident admin still
  gets `above_own`; a platform admin **off-grant** now gets `not_allowed`; the
  same admin **under a grant** may assign it (the one path unmask is handed out).
- added a negative test for the exact escalation the review found: off-grant, a
  platform admin may take the floor `student` self-join but is refused
  self-promotion **and** any role write on another member.

```bash
pnpm -C packages/modules/identity test:integration   # isolation suite (Postgres)
pnpm -C apps/web exec vitest run test/migration-journal-parity.test.ts
```

Journal parity and typecheck verified locally; the isolation suite runs in CI
(Postgres + RLS).

## Follow-ups

Remaining findings from the same composed review, to land as their own PRs:

- **M (RLS):** `verification_requests` PII (`full_name`, `roll_number`, `note`)
  and `tenant_memberships` moderation columns (`standing_reason`, `appeal_note`,
  `verified_at`/`verification_method`) are readable tenant-wide under RLS,
  gated only at the app layer today — route them through a permission-gated view
  or definer so RLS is the boundary.
- **Low:** stale config-admin prose in `membership.ts` / `platform.ts`, the
  `VerificationMethod` `'config'` member, the isolation FORCE-map test omitting
  `verify_prompt_dismissed` + the role-template tables, and a load-bearing-comment
  on `db-grants.sql`'s default-privileges block.
- Then: update `docs/design-platform-admin.md` + the status doc to the shipped
  system.
