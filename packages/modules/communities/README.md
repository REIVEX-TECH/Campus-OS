# @campusos/module-communities

Reddit-style communities inside one university: communities, memberships with
RBAC roles, posts, comments, votes, reports, moderation, and the anonymity
model. Design: `docs/design-communities.md`.

Every table is tenant scoped under RLS. The anonymity of an anonymous post is a
property of the database, not of the code that reads it: the application role
cannot select `author_id` on posts or comments at all; it reads through views
that mask the author unless the reader is the author, and the one way to unmask
is a `SECURITY DEFINER` function that requires an explicit permission, an open
report, and writes its audit line in the same transaction.

This module has its own migration bookkeeping table
(`__drizzle_migrations_communities`). It never imports another module; the
shared contracts are the permission catalogue in core and the SQL functions the
identity module defines (`auth_effective_permissions`).
