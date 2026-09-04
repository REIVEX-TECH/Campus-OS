# feat(communities): a7, anti abuse

## What

Communities A7: automod, the small kind (a community's own keyword and link
domain filters that hold an item for review or remove it), a report
threshold that hides an item until a moderator looks, a Held tab in the mod
tools, and one more duplicate check (the same person posting the same title
in the same community in a day).

The rate limits shipped in A1 (posts, anonymous posts, comments, votes,
reports, communities per day) and the link duplicate check shipped in A3; this
PR finishes the anti abuse list from the design doc.

## Why

Moderators sleep. A filter that holds the obvious spam before anyone sees it,
and a threshold that takes something down once enough people have flagged it,
buy the hours until a person is awake. Both are reversible with one Approve,
and both write to the log as themselves, not as a member.

## How

### Module (`packages/modules/communities`)

- `src/automod.ts`: `screen(tx, communityId, { text, domain })` matches a
  community's rules (keyword: case insensitive substring of title and body,
  or the comment body; domain: the link domain or a subdomain of it; remove
  outranks queue). `applyVerdict` writes the log line as the system actor
  (`00000000-0000-0000-0000-000000000000`) with the pattern in `meta`, and
  returns the reason code stored on the item: `automod:queue` (held) or
  `automod:remove`. `listAutomodRules` is for moderators only (a published
  filter is a guide to evading it); `setAutomodRules` needs
  `communities.manage` or oversight and logs `automod.updated`.
- `createPost` and `createComment` screen inside the insert transaction and
  store a hit as removed with the reason code, so a held item is never
  visible in between. `createPost` now returns `{ id, held }`; it also
  refuses `exists` for the same person's same title in the same community
  within a day, read through the view's `is_own`.
- `reportItem` takes the tenant settings and, at `reportThreshold` open
  reports on one item (default 3, a new tenant setting), stores it removed
  with `auto:reports` and logs `auto_hide` as the system actor; it returns
  `{ id, hidden }`. An already removed item is left as it is.
- `queue.ts`: `listHeld` lists what a filter or the threshold took down in a
  community, newest first, with the reason (`filter_hold`, `filter_remove`,
  `reports`); log entries carry `system: true` when the system actor wrote
  them. Approve (from A6) restores a held item and resolves its reports.

### Web

- `/c/[community]/settings` gains the filters editor for owners: rows of
  kind, pattern and action, saved as a whole through
  `api/communities/[id]/automod`.
- `/c/[community]/mod` gains a Held tab: the queue component with the hold
  reason in place of report reasons; Approve restores.
- The mod log names the system actor as "Automod" and has sentences for
  `automod_hold`, `automod_remove`, `auto_hide` and `automod.updated`.
- The post page turns the reason codes into sentences for the author and the
  moderators ("Held for review by this community's filters", "Removed by
  this community's filters", "Hidden after reports until a moderator looks").
- The report routes pass the tenant settings through.
- Strings: `automod.*`, the held tab and reasons, the code sentences.

## Security

No schema change (`automod_rules` has existed since A1 with tenant isolation).
Screening and the threshold run inside the same transaction as the insert or
the report, through the read views; the system actor is a fixed id that is
nobody's user, and the log lines it writes carry the pattern only in the
moderators' view of the log (a public log shows the sentence). The rules
themselves are readable by moderators only. Nothing here reads an author
column, and the anonymity model is untouched.

## Tests

- Integration (two new cases): rules are refused to a member for reading and
  writing; a keyword hold takes a post out of the feed, shows the author the
  reason code, lists in Held with `filter_hold`, logs `automod_hold` as the
  system actor with the pattern in meta, and Approve restores it and empties
  Held; a domain rule removes a link post outright; a clean post passes; a
  comment is screened too and Held lists both kinds. The threshold: two
  reports leave a post up, the third hides it with `auto:reports`, out of
  the feed, in Held with `reports`, in the queue with three reports and a
  removed state, logged as `auto_hide`; Approve restores and clears the
  queue; the same title again is `exists`. `pnpm turbo run typecheck lint test`: 26 tasks green. Locally
  `pnpm --filter @campusos/module-communities test:integration`: 24 passed, 1
  skipped (the column privilege test, split database only). `pnpm --filter web
build` clean, one new route.
- e2e (one new case): the automod route is 401 to a stranger. `pnpm --filter web test:e2e`: 73 passed against a
  production build.
- Browser (local dev server, as a community owner): the settings page shows
  the Filters editor; a keyword rule "crypto" set to hold saves ("Filters
  saved.") and is there after a reload; a new post whose title contains the
  word lands on its page with the Removed pill, "Held for review by this
  community's filters" and a Restore control for the author; the mod page's
  Held tab lists it as "Held by a filter" with no report pill; Approve empties
  the tab; the log reads "Automod held an item by filter" under the
  moderator's approve line; the post is back in the community's list.

## Verification steps

As an owner: open the community settings, add a keyword rule set to hold and
save; post something containing the word from a second account; the author
sees "Held for review" on their post, nobody else sees it in the feed; open
Mod tools, Held, approve it, and it is back. Set the domain rule to remove
and post a link on that domain. Report one post from three accounts and
watch it disappear at the third; approve it from the queue.

## Migration notes

No schema change. `reportThreshold` is a new tenant module setting with a
default of 3; nothing to set.

## Breaking changes

`createPost` returns `{ id, held }` and `reportItem` returns
`{ id, hidden }`; both are additive for the routes.

## Follow-ups

- A tenant wide Held view for oversight; A6's page shows reports only.
- Regular expression rules and a per rule note are deliberate omissions; a
  substring and a domain cover the spam a campus sees.
- The threshold counts open reports from anyone; a weight for repeat
  reporters whose reports are dismissed is B territory.
