# Communities: design

Reddit-style communities inside one university. Tenant-scoped like everything
else, on the RBAC foundation from `docs/design-platform-admin.md`, with an
anonymity model that is a property of the database, not a habit of the code.

Prerequisite met: the RBAC foundation (Phase 1) is on `main` (`b3d7277`), as are
the members and roles admin (`9271659`) and the permission guard every mutation
now uses. Community roles are RBAC roles in that system; there is no parallel
scheme.

Everything below is the plan. Phase A builds it end to end; Phase B adds the
rest of the Reddit surface. Nothing deferred in §14 is started.

---

## 1. Shape, and where it lives

A new module package, `packages/modules/communities`, with the same layout as
timetable and identity: `manifest.ts` (id `communities`, **its own migration
bookkeeping table** `__drizzle_migrations_communities`, so the frozen base
folder is never touched), `schema/`, `domain/` (pure: ranking, comment paths,
anonymity masking, rate windows), `repositories/` (tenant-scoped, every query
inside a tenant context), `read/` (feeds and pages, cursor paginated), and
`drizzle/`.

The shell already has the layout: centre column for feed, post and comments;
right rail for community info, rules, moderators, trending; left sidebar where
the "Communities" card becomes a live link with a "Your communities" list under
it. A tenant enables the module in `enabledModules`; a disabled module
contributes no routes, no nav item and no query.

Routes under the tenant base:

| Path                                    | What                                         |
| --------------------------------------- | -------------------------------------------- |
| `/c`                                    | Home feed (joined) with a tab for All        |
| `/c/new`                                | Create a community                           |
| `/c/{slug}`                             | Community feed, rail with about, rules, mods |
| `/c/{slug}/submit`                      | Compose (text, link; poll in Phase B)        |
| `/c/{slug}/post/{id}/{title-slug}`      | Post with comments                           |
| `/c/{slug}/settings`, `/rules`, `/mods` | Owner and moderator pages                    |
| `/c/{slug}/mod`                         | Mod queue and mod log                        |
| `/saved`, `/hidden`                     | Private lists                                |
| `/admin/communities`                    | Tenant-admin oversight                       |

Mutations are `POST /api/communities/...` route handlers with the same gate as
every other mutation in the app: same origin, per client limit, a 404 without
the permission, and the permission re-checked inside the transaction.

---

## 2. Data model

Every table carries `tenant_id` and has RLS **with FORCE** and the ordinary
tenant policy; none is read by a definer function except where §5 says so.
Soft delete everywhere (`deleted_at`); removed-by-moderator is a separate state
(`removed_at`, `removed_by`, `removal_reason`) so a mod removal and an author
deletion render differently and both keep the tree.

```
communities            id, tenant_id, slug (unique per tenant), name, description,
                       icon_seed, banner_seed, visibility (public | restricted),
                       allow_anonymous bool, allowed_kinds text[] (text, link, poll),
                       approval_status (approved | pending), mod_log_public bool,
                       member_count int, archived_at, created_by, created_at, deleted_at
community_rules        id, tenant_id, community_id, position, title, description
community_memberships  id, tenant_id, community_id, user_id, joined_at, left_at
                       unique (community_id, user_id)
community_member_roles membership_id, role_id → roles, tenant_id, user_id, granted_at, granted_by
                       pk (membership_id, role_id)
community_bans         id, tenant_id, community_id (null = tenant wide), user_id,
                       reason, until (null = permanent), created_by, lifted_at
community_mutes        same shape as bans, without tenant wide
user_blocks            tenant_id, blocker_id, blocked_id, created_at   pk (blocker, blocked)

posts                  id, tenant_id, community_id, author_id, kind (text | link | poll),
                       title, body, url, url_domain, is_anonymous bool, spoiler bool,
                       flair_id, pinned_at, pinned_by, locked_at, locked_by,
                       removed_at, removed_by, removal_reason, deleted_at, edited_at,
                       up_votes int, down_votes int, score int, hot_score numeric,
                       controversy numeric, comment_count int, created_at
post_edits             id, tenant_id, post_id, edited_at, previous_title, previous_body
post_votes             tenant_id, post_id, user_id, value (-1 | 1), created_at  pk (post_id, user_id)
post_flairs            id, tenant_id, community_id, name, color, position
user_flairs            tenant_id, community_id, user_id, text, color   pk (community_id, user_id)

comments               id, tenant_id, post_id, parent_id, path text (materialised, dotted ids),
                       depth int (cap 8), author_id, is_anonymous, body,
                       removed_at/removed_by/removal_reason, deleted_at, edited_at,
                       up_votes, down_votes, score, best_score numeric, controversy numeric,
                       created_at
comment_edits          id, tenant_id, comment_id, edited_at, previous_body
comment_votes          tenant_id, comment_id, user_id, value   pk (comment_id, user_id)

saved_items            tenant_id, user_id, item_type (post | comment), item_id, created_at
hidden_items           tenant_id, user_id, item_type, item_id, created_at
reports                id, tenant_id, community_id, item_type, item_id, reporter_id,
                       reason (enum, §8), note, status (open | resolved), resolved_by,
                       resolved_at, resolution (approved | removed | dismissed), created_at
                       unique (item_type, item_id, reporter_id)
moderation_actions     id, tenant_id, community_id, actor_id, action, target_type, target_id,
                       reason, meta jsonb, created_at            (the mod log)
automod_rules          id, tenant_id, community_id, kind (keyword | domain), pattern,
                       action (queue | remove), created_by, created_at
```

Phase B adds `polls`, `poll_options`, `poll_votes`, `notifications`, and the
community directory read model.

**Indexes for every hot query.** Feeds: `(tenant_id, community_id, hot_score
desc, id desc)`, `(tenant_id, community_id, created_at desc, id desc)`,
`(tenant_id, community_id, score desc, created_at desc, id desc)`; All feed
uses the same three without `community_id` (leading `tenant_id`). Comments:
`(post_id, path)`. Votes: the primary keys. Reports: `(tenant_id, community_id,
status, created_at desc)`. Memberships: `(tenant_id, user_id)` for "Your
communities" and the Home feed's community list. Bans: `(tenant_id, user_id,
community_id)`. Profile history: `(tenant_id, author_id, created_at desc)
where is_anonymous = false`, a partial index so the public profile query cannot
touch anonymous rows even by accident.

**Cursor pagination everywhere.** Keyset on `(sort key, id)`, encoded opaque
cursors; no offsets. Pages are pages: a "Load more" button, no infinite scroll
and no nested scroll region.

**No N+1.** Feed reads join the community, the author profile (masked, §5) and
the viewer's vote and saved state in one query per page; comment pages load one
subtree in one query ordered by `path`.

---

## 3. Roles and permissions

Three system roles per tenant, seeded by the module's first migration through
`ensureSystemRoles`'s pattern, scoped to a community by
`community_member_roles`:

| Role (key)            | Permissions                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `community_member`    | `communities.post`, `communities.comment`, `communities.vote`                                       |
| `community_moderator` | member's, plus `communities.moderate` (remove, approve, lock, pin, ban, mute), `communities.flairs` |
| `community_owner`     | moderator's, plus `communities.manage` (settings, rules, automod, mods), `communities.transfer`     |

Tenant-level permissions added to the catalogue in core:

| Permission                    | Held by default                          | Guards                                                                          |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `communities.create`          | `student`, `teacher` (verified only, §4) | Creating a community                                                            |
| `communities.oversee`         | `tenant_admin`                           | Tenant-wide mod queue, remove anywhere, tenant-wide ban, dissolve, appoint mods |
| `communities.unmask`          | **nobody by default**                    | Revealing an anonymous author (§5)                                              |
| `post`, `moderate` (existing) | as today                                 | Kept as the coarse tenant-wide grants; community roles are the fine ones        |

Joining a community writes the membership and attaches `community_member`;
leaving detaches it. Creating one attaches `community_owner` to the creator.
Effective permission inside a community is the union of the tenant-wide set
(`auth_effective_permissions`) and the community roles, computed by one new
definer function `auth_effective_community_permissions(user, tenant,
community)` that also returns nothing when the tenant membership is not active,
the community membership has ended, or a ban is in force. It reads
`community_memberships`, `community_member_roles`, `community_bans`, `roles`,
`role_permissions` and `tenant_memberships`: the first three are therefore
created **without FORCE** and added to the invariant map on purpose; the rest
already are.

Which roles exist and what each carries is a **platform-level definition**, not a
tenant's to edit; a tenant administrator sees the definitions read-only and
grants and revokes them, and may never grant a role carrying a permission they
do not hold themselves. See `docs/design-platform-admin.md` §2. The community
roles above are templates on the same footing as the tenant ones.

`tenant_admin` holds every catalogue permission except `communities.unmask`, so
a tenant administrator sits above every community's owner for oversight, and
unmasking still needs an explicit, audited role grant. A platform administrator
acting under a Phase 5 grant is exactly a `tenant_admin`, so the same holds.

---

## 4. Who can do what (tenant settings, with defaults)

`communities` settings schema on the tenant config (Phase 4 made it editable
without a deploy):

| Setting                | Default    | Meaning                                                                |
| ---------------------- | ---------- | ---------------------------------------------------------------------- |
| `readAccess`           | `signedIn` | `signedIn` or `public`; the tenant admin may open reading later        |
| `createCommunity`      | `verified` | `verified` (any verified member) or `approval` (tenant admin approves) |
| `anonymousPosting`     | `on`       | Tenant-wide master switch; each community also has its own toggle      |
| `commentDepth`         | `8`        | Reply nesting cap                                                      |
| `pinnedPerCommunity`   | `3`        | Pin cap                                                                |
| `karmaVisible`         | `off`      | Whether a public karma number is shown at all (§11)                    |
| `archiveAfterMonths`   | `null`     | Idle communities go read only after this many months                   |
| `karmaVotePerDayCap`   | `5`        | How far one voter may move one target's karma in a day (§11)           |
| `floorMinKarma`        | `0`        | Tenant floor a community may tighten, never loosen (§12)               |
| `floorAccountAgeDays`  | `0`        | Tenant floor for account age, in days (§12)                            |
| `floorRequireVerified` | `on`       | Pins verification on for every community (§12)                         |

Post, comment, vote, create, report: **verified** members of the tenant
(`verified_at` set, membership active). Reading: anyone signed in by default.
Every check is server side; hidden buttons are not access control.

---

## 5. The anonymity model

**What it promises.** "Post anonymously" hides the handle from every other
user, community moderators included; the item shows as "Anonymous". The post
stays linked to the account server-side, so the author can edit and delete it,
rate limits apply, and one vote per person holds. The UI says so in the compose
form: _anonymous means hidden from other students, not untraceable by the
university_.

**How it is enforced, in the database.** Repository discipline is not enough
for this; a missed `select *` would leak. So:

1. `posts.author_id` and `comments.author_id` are **not readable** by the
   application role: `REVOKE SELECT (author_id) ON posts FROM campusos_app`, same
   for comments. Any `select *` from the app fails; the test suite asserts it.
2. Reads go through two views the app may select from: `posts_read` and
   `comments_read`, which expose `author_id` as `NULL` when `is_anonymous`
   unless `author_id::text = current_setting('app.user_id', true)` (the author
   sees their own), and carry `is_own` for the UI. The views are `security_invoker`,
   so the underlying RLS still applies to the caller.
3. Own-row updates and deletes use RLS policies (`author_id::text =
current_setting('app.user_id')`), which evaluate without needing column
   SELECT privilege, so "edit my anonymous post" works while "read who wrote
   that anonymous post" cannot.
4. Votes, rate limits and duplicate detection key on `author_id` inside
   INSERT/UPDATE paths and policies only; nothing returns it.
5. Unmasking is one `SECURITY DEFINER` function,
   `communities_unmask(p_item_type, p_item_id, p_report_id, p_reason)`, that
   requires `communities.unmask` (checked via `auth_effective_permissions`
   inside the function), requires the report to exist, be open, and name the
   item, writes the `audit_log` line (`communities.unmasked`, target = item,
   `meta.reportId`) **in the same statement's transaction**, and only then
   returns the author. No report, no unmask. Failing to log means no result.

**Every path the test suite hits**, with an anonymous post and comment by a
known author, as a stranger, a member, a moderator, and a tenant admin:
feeds (all sorts), the post page, the comment tree, the author's public
profile, search (Phase B), notifications (Phase B), the mod queue, the mod log,
edit history, saved and hidden lists of another user, the JSON of every read
route, the sitemap, and the raw table as the app role. Expected: never the
author. Then the author themselves: their private "Posted anonymously" list
shows it; their public profile does not. Then the unmask function: refused
without the permission, refused without an open report, and when it succeeds,
exactly one audit line exists naming the report.

"OP" and "Mod" badges are never rendered on anonymous items, because either
would narrow the author. Sorting never uses author-derived keys.

---

## 6. Ranking

Precomputed on write, in the same transaction as the vote or the post, so reads
are index order and nothing needs a job:

- **hot** (posts): Reddit's, `sign(s) · log10(max(|s|, 1)) + (t − epoch) / 45000`,
  `s = up − down`, `t` = created seconds. Stored as `hot_score`.
- **new** / **old**: `created_at`.
- **top**: `score` with a window (hour, day, week, month, all) as a `created_at`
  bound plus the score index.
- **rising**: posts from the last 24 hours ordered by `score / age_hours`,
  computed at read over that bounded window (a few hundred rows at most).
- **controversial**: `(up + down) ^ (min / max)` when both sides are non-zero,
  stored as `controversy`.
- Comments: **best** = Wilson lower bound (stored `best_score`), **top** =
  score, **new**, **old**, **controversial**. A thread is read as one subtree by
  `path` and sorted in memory per level; depth is capped at the tenant setting.

---

## 7. Feeds

- **Home**: posts from communities the viewer has joined, hot by default.
- **All**: every public community in the tenant.
- **Community**: one community; pinned posts first, capped.
- **Profile**: a person's posts and comments, **non-anonymous only** (the partial
  index in §2 is the only index that query can use). Their own anonymous items
  live in a private list only they can open.

Hidden items and content by blocked users are filtered in the query, not after
it, so pages stay full.

---

## 8. Content safety

**Platform default rules**, inherited by every community and shown above its
own: no harassment or bullying; no hate; no adult or sexual content; no sharing
of others' personal information; no threats. Communities add ordered rules of
their own. Report reasons map to these plus `spam`, `misinformation`,
`breaks community rule` (with the rule picked), and `other` with a note.

Adult content is disabled platform-wide: there is a spoiler tag and no NSFW
mode. Links open with `rel="noopener noreferrer"`, show their domain, and are
never auto-embedded.

---

## 9. Moderation (ships with the MVP)

- **Mod queue**: reported items and automod matches, per community; tenant-wide
  for `communities.oversee`. Approve, remove with a reason, lock, unlock, pin,
  unpin, ban (temporary with expiry, or permanent), mute, and resolve reports.
- **Mod log**: every action, actor, target, reason; visible to moderators;
  public when the community turns it on.
- **Moderators**: the owner invites and removes moderators (a role grant and
  revoke through the RBAC path, audited like any other) and can transfer
  ownership, which swaps roles in one transaction.
- **Blocking**: a blocked person's content is hidden from the blocker, and they
  cannot reply to the blocker's items.
- **Tenant oversight** (`communities.oversee`): sees every community, the
  tenant-wide queue, can remove anywhere, ban tenant-wide (a ban row with no
  community), dissolve a community (soft delete with a reason, members
  notified in Phase B), and appoint moderators. Unmasking is §5, separate.

---

## 10. Anti-abuse

Per person per tenant, in the existing in-process limiter for the request edge
and a table-backed check inside the transaction for what must survive a
restart: posts 5 per hour (anonymous 2 per hour), comments 30 per hour, votes
200 per hour, reports 10 per hour, communities 2 per day. Verification is
required to write at all. Automod-lite: per-community keyword rules (queue or
remove) and a link-domain blocklist. Duplicate detection: the same URL, or the
same normalised title, in the same community within 24 hours is refused with a
link to the original. Report threshold: three distinct reporters hide an item
pending review and put it at the top of the queue.

---

## 11. Karma

**Karma is what other people did.** Upvotes received on a person's posts and
comments, less downvotes received. Nothing accrues for viewing, signing in,
joining, saving, or for posting itself: a score that rises by being present is a
score that rewards idling, and this one cannot be farmed that way because there
is no path from an action of your own to a number of your own.

Per tenant, and two numbers rather than one: **post karma** and **comment
karma**, stored apart and shown together, because "what did they write" and
"what did they say in someone's thread" are different reputations and a single
total hides the difference from moderators who need it.

**Anti-gaming.**

- **No self-votes.** An author's own vote on their own item is refused, not
  silently ignored, so the tally and the karma agree.
- **One vote per person per item**, which the vote tables' primary keys have
  enforced since A3.
- **The vote rate limit**, `votesPerHour`, which has been in `LIMITS` since A1.
- **A per-voter, per-target, per-day cap.** One account can move one other
  account's karma by only so much in a day, so a ring of two cannot inflate
  either, and a grudge cannot bury anyone.

**The anonymous problem, and why the public number excludes them.** An anonymous
post is still the author's, and its votes are still theirs to keep. But karma is
displayed, and a displayed number that moves when an anonymous post is voted on
is a channel: watch a handle's karma, watch an anonymous post's score, and the
correlation names the author. So there are two totals, and only one is public:

| Total       | Counts                    | Seen by                          |
| ----------- | ------------------------- | -------------------------------- |
| **Public**  | Signed items only         | Anyone, per `karmaVisible`       |
| **Private** | Signed and anonymous both | The person, on their own profile |

The private total is summed on `author_id` and therefore inside a definer
function, since the application role cannot read that column. The public total
is summed on the generated `public_author_id`, which is null for anonymous
items, so the public number cannot include one **by construction** rather than by
a filter somebody has to remember.

**Storage.** A `community_karma` row per (tenant, user) holding both halves,
moved in the same transaction as the vote that caused it, and fully recomputable
from `post_votes` and `comment_votes` by a script: the table is a cache of a
derivation, never the only copy. A recompute is the repair for any drift, and
the drift is detectable because the derivation is cheap to run.

**Display is modest.** The profile, and next to a handle in a thread, and
nowhere else; behind the tenant's `karmaVisible` toggle, off by default. No
leaderboards: a campus does not need a ranking of its own students.

---

## 12. Participation gates

A community may ask for more than the tenant does before someone posts in it.
Set by its owner or moderators in the community's settings, every one of them
optional:

| Gate                | Meaning                                       | Default |
| ------------------- | --------------------------------------------- | ------- |
| `minKarmaToPost`    | Public karma needed to post here              | `0`     |
| `minKarmaToComment` | Public karma needed to comment here           | `0`     |
| `minKarmaToJoin`    | Public karma needed to join                   | `0`     |
| `minAccountAgeDays` | Days since the account was created            | `0`     |
| `requireVerified`   | Verified membership needed to post or comment | `on`    |

**Account age is age, not attendance.** Days since `users.created_at`. Nothing
measures time spent in the app, and nothing ever will: a gate that rewards
lingering is a gate that punishes people with less time.

**The tenant sets a floor, and a community may only tighten it.** The floor is a
tenant setting; the effective gate is the greater of the two, computed at the
point of the check, so a community that sets zero does not thereby drop below
what the university requires. `requireVerified` behaves the same way: a tenant
may pin it on and no community can turn it off.

**Whoever moderates here is not who this is for.** A community that sets a
karma gate would otherwise lock out the moderators who set it, leaving them
unable to post an announcement without lowering it first, and they can lower it
at will, so the gate was never a boundary against them. Anyone holding
`communities.moderate` in that community passes every gate in it.

**`requireVerified` can only ever tighten.** Every write in this module already
requires a verified membership, so a community turning it off loosens nothing;
the tenant's `floorRequireVerified` is on by default and is what keeps it that
way. The setting is stored and shown so that a tenant which deliberately opens
up has somewhere to say so, not so that a community can open up on its own.

**Checked where it is enforced, not where it is offered.** The gate runs inside
the same transaction as the write, after the ban and mute checks and before the
rate limits, in `createPost` and `createComment`. The refusal carries the number,
which is new: every refusal in this module until now has been a bare code, and
"you cannot post here" is a worse thing to read than "you need 50 karma to post
here, and you have 12".

---

## 13. Restrictions, suspensions, and reporting a person

Communities can already ban and mute inside themselves (§9). Two things sit
above that and belong to the tenant, not to a community, because they are about
a person's standing in the university rather than their welcome in one room:
**restriction** and **suspension**. Both are described in
`docs/design-platform-admin.md` §6, which owns the membership model; what
belongs here is what they mean to this module.

- A **restricted** person reads everything they could read before and writes
  nothing: no post, no comment, no vote, no report, no community. They pass the
  same `isVerifiedMember` check every write already passes, and fail it on
  standing rather than on verification.
- A **suspended** person does not have a session in this tenant at all, so no
  question about content reaches this module.

**Reporting a person, not only a post.** `reports` gains `item_type = 'user'`
alongside `post` and `comment`, with `community_id` nullable, because a person
does not belong to a community the way a post does. Those reports land in the
tenant-wide queue rather than in a community's, since only a tenant
administrator can act on them; the per-item dedup (`reports_item_reporter_uq`)
already means one report per person per target, and repeated reports from
**different** people on the same person raise a flag on the queue the way the
threshold already raises one on an item.

The queue lives on `/admin/members`, not on `/admin/communities` as first
sketched. It is gated on `restrict-members` rather than `communities.oversee`,
and restricting or suspending is what an administrator does about a reported
person, so the queue sits directly above the controls that carry it out instead
of on a page that would only send them somewhere else.

And nothing about a person is ever applied automatically. An item at the
threshold hides itself, because hiding a post is reversible and cheap; a person
at the threshold is only flagged, because the answers to a person are
restriction and suspension and both are decisions a human takes and signs.

**Never quietly.** Nothing here is shadow-applied. The person sees their own
status, its reason and its expiry, on their account page, and has one appeal
note. This is the same rule as §5's promise about anonymity, pointed the other
way: the platform does not lie about what it has done to you, and it does not
lie about who you are to anyone else.

---

## 14. Deferred, on purpose

Documented as decisions, not built, and not to be started by any phase item:

- **Image and media uploads**: needs a moderation pipeline and storage behind a
  core interface; text and links only until then.
- **Direct messages and chat**: needs its own safety design (reporting,
  blocking, retention) before a line is written.
- **Awards and payments**: no paid tiers, no payment provider.
- **Wiki**: later, if communities ask.
- **Email notifications and digests**: in-app only in Phase B; email needs the
  provider interface and unsubscribe handling.
- **Account deletion**: a soft delete that anonymises what the person wrote
  rather than tearing holes in other people's threads. Wanted, specified when
  it is built, and not before: it touches every table that carries an author.
- **Export my data**: later, and after account deletion, since both need the
  same inventory of what is held about a person.

If a phase item appears to need one of these, that item stops and the need is
noted here.

---

## 15. Phases

**Phase A, MVP core and moderation.** One PR per item unless two are tiny.

- **A1** Schema, RLS, RBAC wiring, the anonymity views and column privileges,
  the module manifest with its own bookkeeping table, `communities.*` in the
  catalogue, the definer function. Tests: cross-tenant isolation on every
  table; a non-moderator cannot remove, ban, pin or lock; owner-only actions;
  one vote per person per item; the FORCE map; **the anonymity suite** (§5).
- **A2** Communities: create (with the approval setting), settings, generated
  icon and banner from the existing avatar shapes, join and leave, member list,
  rules editor, the right rail. `/c/{slug}`.
- **A3** Posts: text and link, edit with history and an "edited" marker,
  soft delete, permalinks, copy link, save, hide, report, spoiler, flair, and
  the anonymous option with its disclosure.
- **A4** Comments: nested with collapse, depth cap, reply anywhere, edit and
  delete with the "[deleted]" placeholder, votes, save, report, anonymous, OP
  and Mod badges (never on anonymous items), sorts.
- **A5** Voting and ranking: votes, scores, precomputed hot, every sort, the
  three feeds, cursor pagination, paged UI.
- **A6** Moderation: queue, actions, bans and mutes, moderator management and
  owner transfer, the mod log with its public toggle, blocking, tenant
  oversight including the audited unmask.
- **A7** Anti-abuse: the limits, the verification requirement, automod-lite,
  duplicate detection, the report threshold.
- **A8** UI: post cards with the vote column, community page with banner and
  rail, compose, threads, feeds with sort tabs, inline mod tools, mod queue,
  settings pages, saved page, "Your communities" in the sidebar, trending in the
  rail, empty and error states. Playwright: create → post → comment → vote →
  report → moderator removes → banned user cannot post; and the anonymity leak
  test in the browser.

**Phase B, the rest of the surface**, after A merges: **B1** polls; **B2**
in-app notifications with the unread count in the top bar; **B3** search and
the community directory; **B4** flair management, pinned ordering, crosspost
within the tenant, share; **B5** profile pages with history, modest karma
behind the tenant toggle, private saved and hidden lists, blocked users
management; **B6** polish: subscriber counts, created info, rules acceptance on
first post, automod settings UI, mod log public toggle, archive after N months.

A status note lives in `docs/communities-status.md` once A1 opens.

**Phase C, governance**, after B merges and alongside the platform work it
leans on (`docs/design-platform-admin.md` phases 6 and 7):

- **C1** Karma (§11): the `community_karma` table moved with each vote, the
  public and private totals, the self-vote refusal, the per-voter per-day cap,
  the recompute script, and the display behind `karmaVisible`. Tests: a
  self-vote is refused; the public total excludes anonymous items and the
  private one includes them; the cap holds; a recompute reproduces the stored
  numbers exactly.
- **C2** Participation gates (§12): the five community settings, the tenant
  floor, the checks inside `createPost`, `createComment` and `joinCommunity`,
  and refusals that carry the number they are about. Tests: each gate blocks
  and then admits the same person; a community cannot set itself below the
  tenant floor; zero means off.
- **C3** Reporting a person (§13): `item_type = 'user'`, the tenant-wide queue,
  the repeated-report flag, and the restriction surfaces this module shows a
  restricted member. Tests: a restricted member is refused every write and
  refused nothing they read; the flag raises on reports from different people
  and not on one person's repeats.

C1 and C2 need nothing from the platform phases. C3 needs the `restricted`
status from platform phase 7, and its own half can land first.

---

## 16. Open questions (defaults chosen; say if different)

1. Comment depth cap 8, pinned cap 3, and the rate limits in §10 are starting
   values, all tenant settings.
2. Reading requires sign in by default. Opening a tenant's communities to the
   public is one setting away and off.
3. Karma is computed from Phase A's votes but shown only in Phase B, off by
   default.
4. The community roles are system roles a tenant cannot delete, like
   `tenant_admin`; a tenant may add roles of its own with community permissions
   (a "helper" role with `communities.flairs` only, say) through the existing
   Roles page.
