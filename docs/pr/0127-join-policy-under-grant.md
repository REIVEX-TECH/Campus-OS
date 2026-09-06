# feat(identity): a tenant's join policy edited only under a grant or by an admin

Phase 5B, item 3d. `allowedEmailDomains` and `joinMode` govern who may auto-join a
university (a verified email on an allowed domain self-verifies as a student).
They used to be plain fields on the platform config form, changed as a bare
platform-admin action. This moves them behind an audited, contained write: a
membership-governance lever should be a deliberate act, not a form field, and a
DB-editable value should never quietly decide who gets in (CLAUDE.md §8).

They still live in `tenant_configs.config`, so sign-in consumption
(`ensureDomainMembership` -> `auth_verify_self_by_domain`) is unchanged. What
changes is the writer.

## What

- **`auth_set_join_policy(tenant, join_mode, allowed_domains[])`** (identity
  `0024`), an app-callable `SECURITY DEFINER`. It authorizes on one test for both
  callers: the actor must hold `manage-members` in this tenant, resolved through
  `auth_effective_permissions` -- from membership for a resident admin, and from
  the grant for a platform admin under an **open grant for this tenant**, whose
  branch re-checks the actor is still a `platform_admin` with a live grant and
  yields nothing for another tenant. So the privilege decision keys on that
  unforgeable resolution (the txid-stamped grant use-row), never on a bare GUC; a
  de-admined holder of a still-open grant, or a grant for a different tenant, is
  refused. It updates only those two keys (`jsonb_set`, other config untouched),
  bumps the version, and audits a distinct **`tenant.join_policy_updated`**
  (grant-stamped by the `audit_log_stamp_grant` trigger when under a grant).
  `tenant_configs` has RLS without FORCE, so the owner-run definer is the
  sanctioned writer while the app role stays blocked under a grant by the `0018`
  RESTRICTIVE policy.
- **Structural consumer-domain guard.** The definer refuses a curated blocklist of
  common consumer providers (gmail/outlook/hotmail/yahoo/icloud/proton, ...) in
  `allowedEmailDomains`: a consumer domain would auto-verify the whole internet as
  students, and that must be unreachable by mistake or by a direct call. Open
  membership, if ever wanted, must be a deliberate `joinMode`, never a side effect
  of a domain entry.
- **The two fields leave the platform editor.** `tenant-form.tsx` drops the
  `joinMode` and `allowedEmailDomains` inputs; `createTenant` seeds a closed
  default (domain mode, no domains) and `updateTenantConfig` preserves the stored
  values, so the general editor can never rewrite who auto-joins.
- **A join-policy editor** in the tenant admin surface
  (`/u/[slug]/admin/join-policy`, gated `manage-members`), a server-rendered form
  posting through the `withTenantAccess` seam (`tenantWriteContext`), so a platform
  grant carries `manage-members` and a resident admin uses their own membership.

## Why grant OR tenant_admin

These fields govern member auto-join, never admin, so tenant self-service is
correct: a resident admin manages their own domains, and a platform admin can do
it under a grant without a tenant membership. The audit records which (`via:
'grant' | 'member'`).

## Data & migration impact

Migration `0024` (identity): one app-callable definer, no schema/table change,
writes no data. Backwards-compatible; the two config keys keep their meaning and
location. No rollback needed.

## Tests

`packages/modules/identity/test/isolation.integration.test.ts` -- a new
`describe('setting a tenant join policy (0024)')`:

- a tenant admin sets mode + domains, only those keys change, audited `via: member`;
- a consumer provider is refused (`blocked_domain:gmail.com`), nothing written;
- a non-member, and a platform admin **without** a grant, are refused;
- a platform admin **under a grant** succeeds and the audit is grant-stamped;
- a grant for another tenant is refused (the decision keys on the grant tenant);
- a de-admined holder of a still-open grant is refused (the liveness re-check).

Runs against split Postgres in CI:

```bash
pnpm -C packages/modules/identity test:integration
```

The now-live `DEFINER_INTENT` guard also gains `auth_set_join_policy: 'app'`.

## Verification

Sign in as a tenant admin, open `/u/lgu/admin/join-policy`, add a university
domain and save; try `gmail.com` and see it refused. As a platform admin, enter
the tenant on a grant and change it; the audit line is grant-stamped.

## Security review (§6)

An adversarial pass on the definer found and fixed two Medium issues before merge.
The grant path now resolves authority through `auth_effective_permissions` (whose
grant branch re-checks platform-admin status and grant liveness) rather than the
bare use-row, so a de-admined holder of a still-open grant is refused, like every
sibling definer. And `updateTenantConfig` reads the stored join policy under a
`FOR UPDATE` lock inside its transaction, closing a TOCTOU where a concurrent
general edit could revert a definer-set policy. Both are covered by the new tests.

## Follow-ups

- 3b (retire `ensureConfiguredAdmin` self-seeding) remains, gated on running 3a's
  migration in production first.
