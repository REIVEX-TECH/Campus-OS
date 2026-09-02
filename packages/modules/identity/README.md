# @campusos/module-identity

The identity data model: users, sessions, tenant memberships, platform roles,
released handles, and the audit log.

Firebase is used only as the Google sign in provider. It answers "does this
person control this Google account" and nothing more. Everything that makes
someone a user of CampusOS lives here, in Postgres, under RLS.

Most tables are platform level, because a person exists above any one
university. They are protected by a second transaction local context,
`app.user_id`, set by `withActor`, alongside the existing `app.tenant_id`.
`tenant_memberships` carries both and is the join between the two worlds.

See `docs/design-identity.md` for the full design, including the audited
platform admin context switch that this module's `audit_log` exists to serve.
