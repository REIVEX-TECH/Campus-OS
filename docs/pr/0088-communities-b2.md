# feat(communities): b2, notifications

## What

In-app notifications: a comment on your post, a reply to your comment, a
moderator's removal of either; a bell in the top bar with the unread count;
an inbox page at `/notifications` with mark all as read and paging. In-app
only, as the design decided (email needs the provider interface and
unsubscribe handling).

## Why

A community is a conversation, and a conversation you cannot tell has
continued is a monologue. The bell is the one piece of the top bar the
design reserved for Phase B.

## How

### Schema, `packages/modules/communities/drizzle/0002_notifications.sql`

- `notifications (id, tenant_id, user_id, kind, actor_id, community_id,
post_id, comment_id, read_at, created_at)` with an inbox index and a
  partial index on unread rows.
- RLS on, the tenant policy, and a restrictive own row policy: the app role
  reads and updates a recipient's rows as that recipient and nobody else's.
  Not FORCED, deliberately: the rows are written by
  `communities_notify(kind, post_id, comment_id, actor, actor_public)`, a
  SECURITY DEFINER function, because the recipient of "someone commented on
  your post" is an author the app role cannot read. The function looks the
  recipient up, returns nothing, writes nothing when the actor is the
  recipient, and records the actor only when `actor_public` (a signed
  comment); an anonymous comment notifies as "someone". The RLS invariant
  test pins `notifications` as unforced. The app role has no INSERT on the
  table.

### Module

- `src/notifications.ts`: `notify` (inside the writer's transaction),
  `listNotifications` (own rows joined with the community, the post's title
  through `posts_read`, and the actor's public profile; keyset paging),
  `unreadCount`, `markRead(ids | 'all')`.
- `createComment` notifies the post's author for a top level comment and the
  parent's author for a reply, unless the comment was held by a filter;
  `removeItem` notifies the author with no actor.

### Web

- The top bar shows a bell with the unread count for a signed in person on a
  tenant with the module; the shell computes one count per page, nothing
  when signed out.
- `/notifications`: the inbox, newest first, unread lines bold with a dot,
  each linking to the post (with `#comments` for a comment), "Someone" and a
  neutral avatar for an anonymous actor, Mark all as read, Older.
- `api/communities/notifications`: mark some or all as read.
- Strings: `notifications.*`.

## Security

Recipients are resolved inside the database function and never returned; the
app role cannot insert into the table and reads its own rows only. An
anonymous item never puts its author into a row, so the inbox cannot leak
one; the integration case asserts the serialized inbox holds no such id. The
bell adds one own row count per page render for signed in people.

## Tests

- Integration (one new case): a signed comment notifies the post's author
  with the actor's handle, an anonymous one with no actor, the author's own
  comment not at all; the serialized inbox never carries the anonymous
  commenter's id; the unread count is right and nobody else's inbox has the
  rows; a reply notifies the parent's author and not the post's, a self reply
  nobody; a removal notifies with no actor; marking some, then all, as read
  moves the count and another person's ids mark nothing; paging continues
  from the cursor. The RLS invariant pins the table as unforced. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 26 passed, 1
  skipped (the column privilege test, split database only), against a test
  database that applied `0002_notifications` on setup. `pnpm --filter web
build` clean.
- e2e (one new case): the inbox redirects a stranger to sign in and the
  mark read route is 401. `pnpm --filter web test:e2e` against a production build:
  80 passed on the first run, 80 passed on the second.
- Browser (local dev server): as a second, freshly minted member, joined the
  community and left one signed and one anonymous comment on the owner's
  poll; back as the owner the bell reads 2, the inbox lists "Someone
  commented on your post" with a neutral avatar and "Flint_Orbit_9028
  commented on your post" with theirs, both bold with a dot and the post's
  title beneath; Mark all as read clears the bell and the button.

## Verification steps

Run the migration (below). From a second account comment on one of your
posts: the bell shows 1, the inbox names them and links to the post; comment
anonymously from the second account and the inbox says "Someone"; mark all
as read and the bell clears.

## Migration notes

`packages/modules/communities/drizzle/0002_notifications.sql`, applied by
`pnpm db:migrate:all`. Additive: one table, two indexes, one function.
Rollback: drop the function and the table. Your step on the live database.

## Breaking changes

None.

## Follow-ups

- Poll closings and mentions are not notified; both need a job or a parser
  that Phase B has not reached.
- Notifications older than a season could be pruned by a job with B6's
  archive work.
