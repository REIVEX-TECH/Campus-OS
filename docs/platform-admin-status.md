# Platform admin: phase status

Design: `docs/design-platform-admin.md`.

| Phase | What                                                      | State                                |
| ----- | --------------------------------------------------------- | ------------------------------------ |
| 0     | Design doc                                                | Written                              |
| 1     | RBAC schema, RLS, resolver, guard; migrate `tenant_admin` | Merged, `b3d7277`                    |
| 2     | Tenant-admin UI for members and roles                     | Merged, `9271659`                    |
| 3     | Analytics with activity timing                            | **In review** (this PR)              |
| 4     | Tenant config file to database, super-admin tenant CRUD   | Not started                          |
| 5     | Cross-tenant god-mode                                     | **Gate: plan only, awaiting review** |

Queued behind these: the Communities module (`docs/design-communities.md`, not
yet written), whose community roles are to be RBAC roles in the Phase 1 model
rather than a parallel scheme.

## Notes for whoever picks this up

- `SUPERADMIN_EMAILS` and every live database migration are run by a human, from
  a runbook. Nothing here runs against production on its own.
- The rule that has cost the most time in this project: a `SECURITY DEFINER`
  function cannot read a table with `FORCE ROW LEVEL SECURITY`; it is filtered
  exactly as its caller would be and silently returns nothing. The FORCE state of
  every identity table is pinned by a test for that reason.
