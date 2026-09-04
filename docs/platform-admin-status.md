# Platform admin: phase status

Design: `docs/design-platform-admin.md`.

| Phase | What                                                      | State                                |
| ----- | --------------------------------------------------------- | ------------------------------------ |
| 0     | Design doc                                                | Written                              |
| 1     | RBAC schema, RLS, resolver, guard; migrate `tenant_admin` | Merged, `b3d7277`                    |
| 2     | Tenant-admin UI for members and roles                     | Merged, `9271659`                    |
| 3     | Analytics with activity timing                            | Merged, `9769360`                    |
| 4     | Tenant config file to database, super-admin tenant CRUD   | Merged, `548b0ca`                    |
| 5     | Cross-tenant god-mode                                     | **Gate: plan only, awaiting review** |
| 6     | Role definitions to platform templates; no upward grant   | Merged, `9afc010`                    |
| 7     | Membership for everyone; restriction and suspension       | Merged, `e385281`                    |

The Communities module (`docs/design-communities.md`) is built: phases A and B
are merged, and its governance phase C leans on 6 and 7 above.

Phases 4 and 5 above record what was true when they were written; 1 to 4 are
merged and 5 is still a plan awaiting review. Phases 6 and 7 come from the
governance addendum and do not wait for 5.

## Notes for whoever picks this up

- `SUPERADMIN_EMAILS` and every live database migration are run by a human, from
  a runbook. Nothing here runs against production on its own.
- The rule that has cost the most time in this project: a `SECURITY DEFINER`
  function cannot read a table with `FORCE ROW LEVEL SECURITY`; it is filtered
  exactly as its caller would be and silently returns nothing. The FORCE state of
  every identity table is pinned by a test for that reason.
