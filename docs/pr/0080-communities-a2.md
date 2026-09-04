# feat(communities): A2, communities you can see, start, join and run

Targets `main`. Communities **Phase A2** of `docs/design-communities.md` on the
A1 foundation: the module becomes a live part of the shell, and a university
gets its first community pages. Posts arrive with A3; every post surface here is
an honest empty state.

## What

**The module is real in the shell.** The "Communities" card in `lib/modules.ts`
is live (`/c`) and gated by the tenant: a card that names a `moduleId` is shown
only when the tenant enables it, so a disabled module contributes no link.
Signed in, the sidebar gains a "Your communities" section under the modules,
each row the community's generated mark and its name. LGU's file config enables
`communities`; the runbook notes that once a tenant's row exists in the
database the module is enabled there (one save in `/admin`, or
`pnpm tenants:sync`).

**Tenant module settings.** `tenantConfigSchema.moduleSettings` (a record by
module id, default empty) carries each module's own settings, validated by the
module's `settingsSchema` when read (`lib/communities.ts`). The communities
defaults from the design apply until a tenant sets otherwise: reading needs a
sign in, any verified member may create, anonymous posting on.

**Pages** under the tenant base:

| Path                 | What                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/c`                 | Your communities, all communities, "New community"; the platform rules in the rail                                                                                                       |
| `/c/new`             | Name, description, post kinds, visibility, the anonymous toggle with its disclosure                                                                                                      |
| `/c/{slug}`          | Banner and mark, name, member count, join or leave, the posts area (empty until A3); rail with about, the platform rules and the community's own, moderators; a Settings link for owners |
| `/c/{slug}/settings` | Settings form, the rules editor (ordered, up to twenty), the moderators panel (make or remove a moderator, make owner)                                                                   |
| `/c/{slug}/members`  | Everyone, owners and moderators first, handles only                                                                                                                                      |

An unknown slug is 404 whoever asks. Reading a known page asks for a sign in
when the tenant setting says so (an empty state with the link, not a 404).
`/c/new` and `/settings` send a stranger to sign in; `/settings` is 404 to a
signed in person who is neither an owner nor a university administrator.

**Routes** (`/api/communities/...`, one gate in `lib/community-route.ts`):
same origin, per client limit, 401 signed out, body validated, tenant resolved
from the body, 404 for a tenant without the module; then the module decides
and every refusal comes back by name with a status the form can branch on.
Create; join or leave; settings; rules; roles.

**Module** (`@campusos/module-communities`): `directory` (live public
communities biggest first, pending ones for administrators, a person's
standing in one), `settings` (replace settings, the slug never changes;
approve a pending community, `communities.oversee`), `rules` (list, replace as
a whole, up to twenty, logged), `members` (owners, then moderators, then by
join date; moderators alone for the rail). Owner actions require
`communities.manage` or `communities.oversee`, re-checked in the transaction;
settings and rules changes land in the community's mod log.

## Data & migration impact

No schema change. `moduleSettings` is a new optional field on the tenant config
(file and row) with a default, so every stored config keeps validating.

## Tests

- Integration (`packages/modules/communities`, three new cases): the directory
  lists live public communities and hides a restricted one and a pending one,
  which a member cannot approve and a tenant administrator can; settings and
  rules change for an owner and are refused to a member, the slug stays put
  when the name changes, rules replace as a whole, and the mod log carries one
  line per change; the member list orders owner, moderator, member with each
  person's roles, moderators alone for the rail, and a person's standing
  follows joining and leaving. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 12 passed, 1
  skipped (the column privilege test, split database only). `pnpm --filter web
build` clean, five new routes.
- e2e (`communities.spec.ts`): the module link is in the nav; `/c` is 200 with
  the sign in prompt; `/c/new` redirects to sign in; an unknown community is
  404; the create and join routes are 401 to a stranger and 403 without our
  origin. `pnpm --filter web test:e2e`: 69 passed against a
  production build; `pnpm --filter web build` clean.
- Browser (local dev server, a verified LGU administrator's session): the
  sidebar shows Communities as a live module; `/c` renders the empty
  directory with New community and the platform rules in the rail; creating
  "CS Freshers" lands on `/c/cs-freshers` with the generated banner and mark,
  "1 members", Leave, the empty posts area, and the rail (About with Members
  and Settings links, the five platform rules, Moderators listing the owner);
  Members lists the owner; Settings renders the form, the rules editor and
  the moderators panel, and a saved rule ("Be kind") appears in the
  community's rail; the sidebar then lists CS Freshers under Your
  communities. One fix from the pass: the create form refreshes the shell
  before navigating, so the new community is in the sidebar at once.

## Verification steps

1. Deploy; on LGU's row in `/admin`, add `communities` to Enabled modules and
   save (or `pnpm tenants:sync`). "Communities" appears in the sidebar within
   30 seconds.
2. Signed in as a verified member: `/c` → New community → it opens at
   `/c/<slug>` with you as owner; Settings shows the form, rules and
   moderators; a second member can join from the page and appears in Members.
3. Signed out: `/c` shows the sign in prompt; `/c/<slug>/settings` redirects.

## Follow-ups

- A3: posts, the compose page, and the feed area on the community page.
- Restricted communities are created and shown but have no invitation flow yet
  (A6 moderation tools).
- The community banner and mark are generated from seeds; a picker to reroll
  them, as the avatar has, is a small later addition.
