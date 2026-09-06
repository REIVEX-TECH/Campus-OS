# feat(communities): richer public profile, and a post-history privacy fix

Block 2. The member profile at `/u/[slug]/people/[handle]` gains member-since, an
Admin badge, the post/comment karma split, and a self "Edit profile" link; more
handles across the app link to it; and a real privacy gap in the post history is
closed. No RLS/definer/grant change (§6 not required), but it fixes a
visibility leak, so it ships with a guarding test.

## The privacy fix

`postsByAuthor` (the profile's Posts tab) excluded anonymous and removed posts,
but — unlike `commentsByAuthor` — it did **not** require the post's community to
be public and live. So a member's signed post in a **private/restricted or
dissolved** community appeared on their public profile. Fixed by adding
`communities.visibility = 'public'` + `communities.deleted_at IS NULL` (an inner
join now), exactly the boundary `readComments` already enforces. A new test
asserts a signed post in a restricted community stays off the profile.

## What else

- **Member-since + Admin badge**: a new read-safe `memberPublicFacts(tenantId,
userId)` in identity returns `{ memberSince, isAdmin }` — join date, and whether
  the member carries an administrator's reach (derived from the unforgeable
  resolver, so a granted admin counts, not only the seeded one). It exposes no
  name, email, or verification status. The web page composes it with communities'
  `profileByHandle` (§4: the app layer composes modules; communities never reads
  identity's tables).
- **Karma split**: the page now shows "{posts} from posts, {comments} from
  comments" beside the total (both already on the `Karma` type). The private
  anonymous delta stays own-only via `ownKarma`. Existing karma, surfaced.
- **Self "Edit profile" link** to `/account` when viewing your own profile.
- **More handles link to the profile**: the community members roster and the
  rail's moderators list now link each handle/avatar to
  `/u/[slug]/people/[handle]` (post cards, comment threads and L&F already did).
- **Anonymity holds**: nothing anonymous appears on or links to a profile — the
  reads key on the null-when-anonymous public-author column. The existing test
  (signed-only on `postsByAuthor`/`commentsByAuthor`) covers it; the new
  visibility test strengthens it.

## Deferred (logged)

- **Message button** — lands with the messages module (Block 3); Block/Report are
  already on the profile.
- **Per-community moderator badge** — needs a cross-community role read; the
  tenant Admin badge (the primary staff signal) ships now.
- A few secondary handle surfaces (notifications actor avatar, blocked list,
  admin rosters) still do not link to the profile.

## Data & migration impact

**No schema change, no migration.** One query gains two predicates; one new
read-only identity function.

## Tests

`communities.integration.test.ts`: a new test that a signed post in a restricted
community is excluded from `postsByAuthor` (the fix), alongside the existing
anonymity-on-profile coverage.

```bash
pnpm -C packages/modules/communities test:integration
pnpm --filter web test
```

## Verification

```bash
pnpm --filter web build
```

- `/u/lgu/people/<handle>`: header shows the Admin badge (for an admin), "Member
  since <Month Year>", karma total + split; your own profile shows "Edit profile".
- A member's post in a restricted community does not appear on their profile.
- Clicking a handle in a community's members list or the moderators rail opens
  the profile.
