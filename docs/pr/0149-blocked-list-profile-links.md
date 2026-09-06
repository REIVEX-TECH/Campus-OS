# feat(communities): link handles to profiles on the blocked list

A small consistency polish. Every public people-list already links a handle to
its profile (community members roster, moderators rail, post cards, comment
threads, Lost & Found) — the blocked list was the last one showing the handle as
plain text. This wraps the avatar + handle in the same profile link the members
roster uses.

## What

- `apps/web/app/u/[slug]/blocked/page.tsx`: the avatar + handle + "blocked since"
  become a `Link` to `${base}/people/${handle}` (the `ios-pressable ... hover:bg-muted`
  pattern from the members roster). The Unblock button stays outside the link, as
  the trailing action.

## Why it is safe

- Pure JSX; no new data, no query change, no schema, no RLS, no security surface.
- `profileByHandle` resolves a profile independent of block state — a block never
  hides the profile from the blocker (blocking hides feed content, not the profile
  page). So the link always lands on the person's profile, which shows an
  **Unblock** affordance there too. No broken/404 link.

## Data & migration impact

No schema change.

## Tests

No new test. Covered by the existing `apps/web` suite (typecheck + the no-dash
copy guard + journal parity all green); this is a one-surface JSX wrap with no
logic. The linked route (`/people/[handle]`) already has profile coverage.

```bash
pnpm -C apps/web typecheck && pnpm -C apps/web test
```

## Verification

`/u/lgu/blocked` → each blocked person's avatar/handle now navigates to their
profile; Unblock still works from both the list and the profile.

## Follow-ups

- The notifications actor deliberately does **not** link: the whole row is already
  a `Link` to the post, and a nested profile `<a>` would be invalid HTML. Left as
  is (the earlier "minor follow-up" note is resolved: it should not link).
