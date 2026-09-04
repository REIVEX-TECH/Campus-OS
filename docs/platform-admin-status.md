# Platform admin: phase status

Design: `docs/design-platform-admin.md`.

| Phase | What                                                      | State                                  |
| ----- | --------------------------------------------------------- | -------------------------------------- |
| 0     | Design doc                                                | Written                                |
| 1     | RBAC schema, RLS, resolver, guard; migrate `tenant_admin` | Merged, `b3d7277`                      |
| 2     | Tenant-admin UI for members and roles                     | Merged, `9271659`                      |
| 3     | Analytics with activity timing                            | Merged, `9769360`                      |
| 4     | Tenant config file to database, super-admin tenant CRUD   | Merged, `548b0ca`                      |
| 5     | Cross-tenant god-mode                                     | **Reviewed. 5A0/5A merged; see below** |
| 6     | Role definitions to platform templates; no upward grant   | Merged, `9afc010`                      |
| 7     | Membership for everyone; restriction and suspension       | Merged, `e385281`                      |

The Communities module (`docs/design-communities.md`) is built: phases A and B
and the governance phase C are merged; C leans on 6 and 7 above.

## Phase 5, cross-tenant administration — sub-phases

The Phase 5 security core is reviewed and building. It was decomposed after the
security review, and two pre-existing holes it exposed were closed first.

| Step | What                                                             | State             |
| ---- | ---------------------------------------------------------------- | ----------------- |
| 5A0  | `platform_roles` written only by an allowlist-checking definer   | Merged, `10110e5` |
| —    | `universities` gets RLS (was unguarded; deletes cascade)         | Merged, `b8ba354` |
| 5A   | Tenant grants: audited context switch, resolver, containment     | Merged, `4f04509` |
| —    | Membership/role writes behind a definer (the review's hole)      | Merged, `3c95d11` |
| 5B   | Platform-admin surfaces run inside granted transactions          | Planned           |
| 5G   | `SUPERADMIN_EMAILS` + `platform_roles` rotation/recovery runbook | Planned           |

5A0 also closed the hole where the database let any signed-in request insert its
own `platform_admin` row (only TypeScript stood in the way). The corrected 5A
containment keys "under a grant" and "not self" on an unforgeable `platform_grant_uses`
row (one per granted transaction, stamped with its transaction id), never on an
`app.*` GUC the application can set — the class of flaw two review passes broke.

The membership-writes hole 5A's review named is now closed (`3c95d11`):
`tenant_memberships` and `membership_roles` are no longer writable by the
application role; every write goes through an audited definer that checks the
actor, the 5A0 pattern applied to both tables. Its own adversarial pass caught a
repeat of PR #113's `REVOKE FROM PUBLIC` trap (an authority-free helper left
EXECUTE-able by the app) and the one missing not-self-under-grant guard, both
fixed before merge — which is why CLAUDE.md §6 now requires the adversarial pass
over the concrete security SQL, not the design.

**Still owed:** 5B (surfaces under granted transactions) and 5G (the
`SUPERADMIN_EMAILS` + `platform_roles` rotation/recovery runbook).

**Awaiting your review before 5B:** the definer SQL is in
`docs/pr/0104-tenant-grants.md` and `packages/modules/identity/drizzle/0018_tenant_grants.sql`.
The UI phases build on it, so it is the gate.

## Notes for whoever picks this up

- `SUPERADMIN_EMAILS` and every live database migration are run by a human, from
  a runbook. Nothing here runs against production on its own.
- The rule that has cost the most time in this project: a `SECURITY DEFINER`
  function cannot read a table with `FORCE ROW LEVEL SECURITY`; it is filtered
  exactly as its caller would be and silently returns nothing. The FORCE state of
  every identity table is pinned by a test for that reason.
