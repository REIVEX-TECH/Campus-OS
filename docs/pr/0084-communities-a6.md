# feat(communities): a6, moderation

## What

Communities A6: the mod queue, remove and approve with a reason, lock, pin
within the tenant's cap, mute and ban with lifting, a mod log with the
community's public toggle, blocking, and the tenant's oversight page with a
tenant wide queue, dissolution, and the audited unmask of an anonymous author
from a report.

## Why

A community without moderators is a wall. Reddit's shape is what people
expect: reports gather in one place, a moderator approves or removes with a
reason, threads get locked, a few posts stay pinned, and there is a log
anyone can read when the community chooses. Blocking is a person's own
filter. Oversight is the university's, and it is the one place the anonymity
model bends, on purpose, on the record.

## How

### Module (`packages/modules/communities`)

- `src/mod-actions.ts`: `removeItem` and `approveItem` (restore if removed;
  either way the item's open reports resolve), `setLocked`, `setPinned` (the
  cap is `pinnedPerCommunity` from the tenant settings, refused as
  `pin_cap`), `muteMember`, `liftSanction` for a ban or a mute (a tenant wide
  ban needs `communities.oversee` and lifts into the audit log), and
  `listSanctions`. Each is one transaction: the change, the reports, and a
  `moderation_actions` line. `moderates()` is `communities.moderate` in the
  community or `communities.oversee` in the tenant, checked inside the
  transaction. Nothing reads an author column.
- `src/queue.ts`: `listQueue` groups open reports by item (count, distinct
  reasons, report ids, first and last time) with the item's title, excerpt,
  anonymity and removal state through the read views; per community for its
  moderators, tenant wide for oversight. `listModLog` is a keyset page of a
  community's actions with the moderator's handle; the log is readable by
  moderators always and by everyone when `modLogPublic` is on, and a public
  log carries no member's handle or id for bans and mutes.
- `src/oversight.ts`: `listCommunitiesForOversight` (every live community
  with its open report count, pending first), `dissolveCommunity` (soft
  delete plus an `audit_log` line with the reason; every read path already
  excludes a deleted community), `handleOf` for showing an unmask result.
- `src/blocks.ts`: `blockUser`, `unblockUser`, `listBlocked`. Own rows under
  RLS.
- `src/access.ts`: `isMuted`, and the `muted` and `pin_cap` refusals.
  `createPost` and `createComment` refuse `muted`.
- `src/feed.ts`: the viewer's blocks filter posts by public author (an
  anonymous post is untouched, because its author is nobody's to read); a
  community's pinned posts lead its first page in every sort, outside the
  cursor, and are excluded from the paged body.
- `src/comments.ts`: a blocked author's comment keeps its place in the tree
  with its body and name withheld (`blocked: true`), so replies stay
  attached.
- `src/posts.ts`: `PostView.removalReason`.

### Web

- `api/communities/[id]/mod` dispatches remove, approve, lock, pin, mute,
  ban, lift, dissolve, approveCommunity and unmask; `api/communities/blocks`
  blocks and unblocks. Both pass the shared gate; the module decides.
- `/c/[community]/mod`: the queue and the log as tabs. Without the permission
  the page is 404, like a community that does not exist. Unmask is not
  offered here.
- `/admin/communities` (new admin section behind `communities.oversee`):
  every community with approve for the pending and dissolve with a reason,
  and the tenant wide queue. Reveal author appears only when the person holds
  `communities.unmask`, only on an anonymous item, only from one of its
  reports, behind a confirmation that says it is recorded; the handle is
  shown once in a status line and written nowhere on the page.
- `/blocked`: who a person blocked, with unblock.
- The post page: moderators get a controls row (approve or restore, remove
  with a reason, lock, pin); a removed post is a title and "Removed by
  moderators" to everyone but its author and the moderators, who see the
  body and the reason; the composer is off while removed or locked.
- Cards carry Pinned, Locked and Removed pills. "Block {handle}" sits in the
  post actions for a signed author who is not you. Moderators can remove a
  comment from the thread (a reason prompt). The rail links "Mod tools" for
  moderators. The members page gains ban and mute (with a duration) and the
  active list with lift, for moderators.
- Strings: `mod.*`, `oversight.*`, `blocked.*`, the pills, the new
  refusals.

The pages stay pages: tabs and paging are links; there is no nested scroll.

## Security

- No schema change and no new policy or definer function. Moderator writes go
  through the existing tenant isolation policies; the permission is the
  module's check inside the same transaction, as bans already were.
- The anonymity model holds: removal, the queue, the log and blocking are all
  read through `posts_read` and `comments_read`; a queue row for an anonymous
  item says so and names nobody; blocks cannot touch anonymous items; the
  unmask path is unchanged (the definer function checks
  `communities.unmask`, requires an open report on the item, and writes the
  audit line atomically, or raises).
- A public mod log withholds the member behind a ban or a mute; the
  moderator and the item are what is public.

## Tests

- Integration (five new cases): remove refused to a member, refused without
  a reason, done by the owner with the reason readable, the post out of the
  feed and the queue emptied; approve restores; a comment removes; the log
  reads newest first, private by default and public after the setting flips.
  Lock refuses a comment and unlock allows it; three pins, the fourth is
  `pin_cap`, pins lead the first page of a sort outside the cursor, unpinning
  frees a slot, the log pages by cursor. Mute refuses a post, sanctions list
  with a handle for moderators only, lift is moderators only, ban and lift;
  the public log names no member. Blocking hides signed posts from the
  blocker alone, leaves the anonymous one, withholds a comment's body and
  name while keeping its place, lists and unblocks; blocking oneself is
  `self`. Oversight: the tenant wide queue spans communities and is refused
  to a community owner, the list carries open report counts, dissolve is
  refused to an owner and works once for the tenant, after which the
  community is not found. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 22 passed, 1
  skipped (the column privilege test, split database only). `pnpm --filter web
build` clean, three new routes.
- e2e (one new case): the mod page, the oversight page and the blocked page
  are 404, 404 and a sign in redirect for a stranger; the mod and block
  routes are 401. `pnpm --filter web test:e2e`: 72 passed against a
  production build.
- Browser (local dev server, as a community owner): the post page shows the
  moderator row and the rail's Mod tools link; Pin sets the Pinned pill and
  reads "Pinned to the top.", Lock sets the Locked pill and removes the
  composer; Remove appears on each comment; the mod page opens on an empty
  queue with Queue, Log and the members link as tabs; the log lists the lock,
  the pin and the earlier settings and rules changes with the moderator's
  handle; the members page shows the ban or mute form with the members as
  options and "Nobody is banned or muted."

## Verification steps

As a community owner: report something from a second account, open Mod tools
from the rail, approve or remove it with a reason, open the post and lock,
pin and unpin it, open Members and mute the second account for a day, try to
comment as them, lift it. Flip "public mod log" in the community settings and
read the log signed out. As a tenant admin: `/u/<slug>/admin/communities`,
approve a pending community, work the queue, dissolve a test community with a
reason and confirm it is gone and the audit log has the line. Block a person
from one of their posts and confirm their signed posts vanish from your feeds
and their comments show as blocked; unblock from `/u/<slug>/blocked`.

## Migration notes

No schema change.

## Breaking changes

None.

## Follow-ups

- A7 adds the report threshold auto hide and automod rules on top of this
  queue; the `automod_rules` table has waited since A1.
- The audit line for a dissolution is asserted by design, not by a test; the
  integration suite has no reader for `audit_log` yet.
- Comment removal from the thread uses a reason prompt; an inline field like
  the post's can come with A8's polish.
- A mod log entry links a post by id without its title slug; the post page
  resolves it either way.
