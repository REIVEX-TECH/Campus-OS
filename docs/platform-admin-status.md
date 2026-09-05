# Platform admin: phase status

Design: `docs/design-platform-admin.md`.

| Phase | What                                                      | State                   |
| ----- | --------------------------------------------------------- | ----------------------- |
| 0     | Design doc                                                | Written                 |
| 1     | RBAC schema, RLS, resolver, guard; migrate `tenant_admin` | Merged, `b3d7277`       |
| 2     | Tenant-admin UI for members and roles                     | Merged, `9271659`       |
| 3     | Analytics with activity timing                            | Merged, `9769360`       |
| 4     | Tenant config file to database, super-admin tenant CRUD   | Merged, `548b0ca`       |
| 5     | Cross-tenant god-mode                                     | **Complete; see below** |
| 6     | Role definitions to platform templates; no upward grant   | Merged, `9afc010`       |
| 7     | Membership for everyone; restriction and suspension       | Merged, `e385281`       |

The Communities module (`docs/design-communities.md`) is built: phases A and B
and the governance phase C are merged; C leans on 6 and 7 above.

## Phase 5, cross-tenant administration — sub-phases

Phase 5 is complete. The security core was decomposed after the security review
(two pre-existing holes it exposed were closed first), then 5B was built and
adversarially reviewed piece by piece.

| Step  | What                                                             | State             |
| ----- | ---------------------------------------------------------------- | ----------------- |
| 5A0   | `platform_roles` written only by an allowlist-checking definer   | Merged, `10110e5` |
| —     | `universities` gets RLS (was unguarded; deletes cascade)         | Merged, `b8ba354` |
| 5A    | Tenant grants: audited context switch, resolver, containment     | Merged, `4f04509` |
| —     | Membership/role writes behind a definer (the review's hole)      | Merged, `3c95d11` |
| 5G    | `SUPERADMIN_EMAILS` + `platform_roles` rotation/recovery runbook | Merged            |
| 5B.1  | Platform login at `/login`                                       | Merged, `0026ddc` |
| 5B.2a | Session-end revokes the grant (`0021`)                           | Merged, `1fe26ad` |
| 5B.2b | Hardening: loud cleanup log, journal-parity test, FORCE note     | Merged, `a841ea7` |
| 5B.2  | Tenant-access seam + grant lifecycle UI                          | Merged, `1b89462` |
| 5B.2c | Cross-tenant admin writes through the seam                       | Merged, `85f14bb` |
| —     | Remove the dead permission-gate helpers                          | Merged, `bc80a2b` |
| —     | `auth_write_standing` self-check on the grant row (`0022`)       | Merged, `37e4cf3` |
| 5B.3  | Grant `statement_timeout` + typed expiry redirect                | Merged, `b055ec8` |
| 5B.4  | Tenant transparency panel                                        | Merged, `7c44416` |

The tenant-access seam (`apps/web/lib/tenant-access.ts`) is the single boundary
every tenant-admin surface goes through: a platform admin's read or write runs
under an audited grant (or their own membership), grant-precedence over
membership, no silent fallback, tenant-matched at the seam, `withTenantMutation`,
and the `0019` definers. `apps/web/test/admin-seam-boundary.test.ts` forbids the
direct gates in both admin trees so a new surface cannot bypass it. Each 5B piece
that touched security got the concrete-SQL adversarial pass required by CLAUDE.md
§6.

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

**Nothing owed on Phase 5.** Every surface, the runbook, and the transparency
record are merged. Unrelated queued work tracked elsewhere: the verification UX
feature and a timetable e2e deflake.

## Notes for whoever picks this up

- `SUPERADMIN_EMAILS` and every live database migration are run by a human, from
  a runbook. Nothing here runs against production on its own.
- The rule that has cost the most time in this project: a `SECURITY DEFINER`
  function cannot read a table with `FORCE ROW LEVEL SECURITY`; it is filtered
  exactly as its caller would be and silently returns nothing. The FORCE state of
  every identity table is pinned by a test for that reason.
