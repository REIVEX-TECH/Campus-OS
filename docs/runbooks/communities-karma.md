# Recomputing karma

Karma is a cache of a derivation. The running total is moved by each vote, in
the same transaction as the vote; this rebuilds it from the votes themselves.
Nothing else in the product needs to be stopped while it runs.

## When to run it

- The numbers look wrong, or a bug report says one does.
- After restoring a backup, or any restore that could have replayed writes.
- After changing `karmaVotePerDayCap` for a tenant. The cap decides how much of
  each day's voting counted, so changing it changes every total that was ever
  capped. Nothing recomputes on its own, and the old numbers stay until you do.

## Running it

```bash
pnpm communities:karma -- --tenant lgu
```

It prints how many votes were counted. It needs `MIGRATION_DATABASE_URL` (or
`DATABASE_URL` on a database that has not been split), because rebuilding means
reading the author of every item, including anonymous ones. The application
role cannot do that, and is not granted the function.

## What it does

Deletes the tenant's `community_karma` and `karma_ledger` rows, then replays
every vote on a post or comment in the order it was cast, skipping an author's
vote on their own item, applying the daily per-voter cap as it goes.

One thing it cannot reproduce exactly: a vote that was later changed replays
once, at its original time, holding the value it now has. Where that matters
the rebuilt total differs from the running one by less than the cap.

## What it does not touch

Post and comment scores, rankings, and the vote rows themselves. Karma is
derived from votes; votes are the record.
