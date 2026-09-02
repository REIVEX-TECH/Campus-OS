# Overnight run: decisions needed

Items stopped rather than guessed, per the standing rule that an irreversible or
architectural fork waits for review. Everything else in the run continued.

---

## 1. Session resolution needs a database role decision

**Status: blocked, identity PR 1 shipped without it.**

### What happened

The approved design gives session lookup one narrow escape hatch: a
`SECURITY DEFINER` function, `auth_resolve_session(token_hash)`, because
resolving a request's session happens before the user is known, so the read
cannot satisfy the `user_id = app.user_id` policy.

Implemented as designed, it returns zero rows. The reason is structural, not a
bug in the function:

```
connected as        : campusos_app
sessions            : rowsecurity = true, FORCE rowsecurity = true, owner = campusos_app
auth_resolve_session: SECURITY DEFINER, owner = campusos_app
campusos_app        : rolbypassrls = false, rolsuper = false
```

`SECURITY DEFINER` elevates to the function's owner. The owner is
`campusos_app`, which is already the calling role, so it elevates to itself and
gains nothing. `FORCE ROW LEVEL SECURITY` then applies the policy even to the
table owner, which is exactly why it is on (the application connects as the
owner, so without FORCE the app would bypass RLS everywhere). With no
`app.user_id` set, the policy matches nothing and the lookup finds nothing.

So the escape hatch cannot work while the application role and the table owner
are the same role. This is a real gap in the design as written, found by
building it.

### Options

- **(a) Split the roles.** Tables owned by a migration role, for example
  `campusos_migrator`; the application connects as a separate, non-owner
  `campusos_app` with only DML grants. `SECURITY DEFINER` owned by the migration
  role then works, and FORCE still constrains the application role.
  **This is the recommendation**: it is standard practice, it makes the
  ownership boundary real rather than nominal, and it strengthens every other
  table at the same time. It is a deployment change: a new role, ownership
  transfer, and a connection string update.
- **(b) A dedicated `BYPASSRLS` role owning only this one function.** Narrow, but
  it puts a bypass capability in the database, which the design explicitly set
  out to avoid, and contradicts a claim in `docs/design-identity.md`.
- **(c) Policy flag.** The function sets a GUC and the policy honours it. Weaker:
  any caller able to run SQL can set the same GUC, so it protects against
  accident rather than against a compromised application.
- **(d) Do not protect `sessions` with RLS.** Defensible on the grounds that the
  token hash is itself the credential, but it drops a layer of defence for no
  gain once (a) is available.

### What shipped instead

Identity PR 1 ships the tables, the RLS policies, `withActor` /
`withActorInTenant`, and the isolation tests, all passing. The
`auth_resolve_session` function is **not** included, because shipping a function
that silently returns nothing would be worse than not having one. Sign in
(identity PR 2) needs this resolved first, since it is the read that authenticates
every request.

**Decision needed:** which option, and if (a), who provisions the roles.

---

## 2. Identity PRs 2 to 4 were not started

**Status: paused for review, as requested.**

The instructions conflict on how far to go tonight:

- "After PR 1 merges I'll review before you continue to PR 2, since this is the
  highest-stakes module. I want to eyeball each PR's merge, not have you run the
  whole sequence unattended."
- The build list then names identity PRs 1 to 4 with the hard stop at PR 5.
- The do-not-build list also says "anything that changes production auth or
  tenancy behavior", which PR 4 does: it makes admin pages require
  `tenant_admin`.

Rather than guess on the highest-stakes module, PR 1 shipped and the identity
track stopped there. PRs 2 to 4 are ready to start on one word, and item 1 above
has to be settled first regardless, because PR 2 depends on session resolution.

The rest of the overnight list continued.
