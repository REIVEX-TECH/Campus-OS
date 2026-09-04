# feat(communities): A1, schema, isolation, roles, and the anonymity model

Targets `main`. Communities **Phase A1** of `docs/design-communities.md`: the
module package, every Phase A table under RLS, community roles as RBAC roles
with a scoped resolver, the anonymity model enforced in the database, and the
smallest real services (create, join, post, comment, vote, report, ban, unmask)
so the guarantees can be tested against Postgres. No pages yet; A2 to A8 build
on this.

## What

**Module** `@campusos/module-communities` with its own migration bookkeeping
table (`__drizzle_migrations_communities`), so the frozen base folder is never
touched. Wired into `scripts/migrate-all.ts` after identity. It never imports
another module; the SQL functions and the catalogue in core are the contracts.

**Catalogue** (`@campusos/core/rbac`): `communities.create`,
`communities.oversee`, `communities.unmask` (tenant level) and
`communities.post`, `.comment`, `.vote`, `.moderate`, `.flairs`, `.manage`,
`.transfer` (community level). `student` and `teacher` gain
`communities.create`; `tenant_admin` gains everything **except
`communities.unmask`**, which no role holds until a tenant grants it on
purpose. `COMMUNITY_ROLES` (member, moderator, owner) and `isCommunityRole`;
the identity `grantRole` / `revokeRole` refuse a community role at tenant
scope, and the Members page does not offer one.

**Schema** (`0000_communities.sql`): communities, rules, memberships, member
roles, bans, mutes, blocks, flairs, posts, post edits and votes, comments,
comment edits and votes, saved and hidden items, reports, moderation actions,
automod rules. Every table has RLS with the tenant policy; FORCE everywhere
except memberships, member roles and bans, which
`auth_effective_community_permissions` reads (the invariant test pins each).
Restrictive policies make a person write only as themselves (post and comment
author, votes, saved, hidden, blocks, reports). Indexes for every feed sort,
the comment tree, the queue, and a partial index for public profile history
that cannot touch an anonymous row.

**The anonymity model, in the database.**

- The application role **cannot select `posts.author_id` or
  `comments.author_id`** (table SELECT revoked, every other column granted
  back; guarded to a split database, where the app role is not the owner).
- Reads go through `posts_read` and `comments_read`, owned by the schema owner:
  the generated `public_author_id` (null when anonymous) and `is_own`.
- Own edits and deletes check `is_own` through the view and update by id.
- `communities_unmask(item_type, item_id, report_id)` is a `SECURITY DEFINER`
  function that requires `communities.unmask` for the caller in the tenant
  context, an **open report naming the item**, writes the `audit_log` line
  (`communities.unmasked`, the report id and the unmasked user) in the same
  transaction, and only then returns the author; every refusal raises, and the
  TypeScript wrapper runs it in a transaction of its own so a refusal is a
  rejected promise and nothing else.

**Services** (small, real, tested): `createCommunity` (verified, not banned,
`communities.create`, two a day, slug from name, owner role attached, pending
when the tenant requires approval), `joinCommunity` / `leaveCommunity` (the
last owner cannot leave), `setCommunityRole` (owner appoints moderators,
transfers ownership, never removes the last owner), `createPost` / `editPost` /
`deletePost` (kind and anonymity allowed by the community and the tenant
setting, rate limits, duplicate link in 24 h refused), `createComment` /
`editComment` / `deleteComment` (materialised path, depth cap), `votePost` /
`voteComment` (one row per person, tallies moved atomically, hot, controversy
and Wilson best recomputed in the same transaction), `reportItem`, `banMember`
(community or tenant wide), `unmaskAuthor`. Reads: `postById`, `postsByAuthor`
(public history through the generated column), `myAnonymousPosts` (private),
`commentsForPost` (tree order, siblings sorted best / top / new / old /
controversial).

## Data & migration impact

One new migration folder. Additive; nothing existing changes shape. The
migration also seeds the three community roles for tenants that already exist
and the new tenant level permissions on `student`, `teacher` and `tenant_admin`,
all `ON CONFLICT DO NOTHING`. Human-run as usual:

```
pnpm db:migrate:all
```

Rollback: drop the module's tables and functions and the
`__drizzle_migrations_communities` table; delete the `community_*` roles and the
`communities.*` role permissions. Nothing in earlier modules depends on them.

## Tests

- Unit: `hotScore` (ten votes level with twelve and a half hours), `controversy`,
  `wilsonLowerBound`, `applyVote`, comment paths and depth cap, slug rule. Core's
  own test now pins `tenant_admin` to everything except `communities.unmask`.
- Integration (`packages/modules/communities`, runs in CI; locally the column
  privilege test skips on an unsplit database): the FORCE map for all twenty
  tables; a community in one tenant is invisible in the other and the same name
  is free there; the creator holds owner permissions, a joiner member ones, an
  outsider only `communities.create`; an owner appoints a moderator, the last
  owner cannot leave or be demoted, a tenant admin holds `communities.oversee`
  and not `communities.unmask`, and a community role cannot be granted at
  tenant scope; the unverified cannot create or join and a banned member
  resolves to no permissions and cannot post; one vote per person moves rather
  than adds and the ranking columns follow; **the anonymity suite**: the app
  role cannot read `author_id`; an anonymous post and comment show no author
  and `isOwn` false to a stranger, the community owner and the tenant admin,
  `isOwn` true to the author, never on the public profile, on the private list;
  only the author edits or deletes; unmasking is refused to a tenant admin, to
  a holder of the permission without an open report, and to the community
  owner, succeeds with the permission and a report, and leaves exactly one audit
  line naming the report and the person. The identity suite's role
  expectations follow the catalogue change. `pnpm turbo run typecheck lint test`: 26 tasks green (communities 12 unit;
  core 38, identity 47, timetable 56, adapter 12, web 73). Locally
  `pnpm --filter @campusos/module-communities test:integration`: 9 passed, 1
  skipped (the column privilege test, which needs the split database CI has).
  `pnpm --filter web build` clean.
- e2e: unchanged (no pages yet).

## Verification steps

`pnpm db:migrate:all`, then `select key from roles where tenant_id = 'lgu' and
key like 'community_%'` lists the three roles; `select permission from
role_permissions rp join roles r on r.id = rp.role_id where r.key =
'tenant_admin' and r.tenant_id = 'lgu' and permission like 'communities.%'`
lists everything but `communities.unmask`.

## Follow-ups

- A2 onwards: pages, the rail, feeds with cursor pagination (the indexes are in
  place), the mod queue and the remaining moderation actions on these tables.
- The comment tree read sorts siblings in memory per page of one post; a very
  long thread will want a paged subtree read.
- Adding a column to `posts` or `comments` needs the column grant list in the
  migration extended, or the application will not see it. Recorded in the
  migration header.
