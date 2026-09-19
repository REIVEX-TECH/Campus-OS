# Official account

An official account is a first-party account (the platform's or a campus's own) that
carries an "Official" badge and may post in any community, subject to the content rules.
It is how a tenant announces a module launch, and how lost/found and for-sale items that
land in the wrong place get re-posted into the right module with a link back. This is
honest seeding by a clearly-labelled real account, not bots and not fake users.

Nothing here runs automatically. Every step is an operator choosing to run it against a
real tenant. It does not touch LGU unless an operator runs it against LGU.

## What "official" grants (and does not)

- **Grants**: the account may post in any community without being a verified member of it,
  regardless of that community's karma / account-age / rules gates. It gets the badge on
  its profile.
- **Does not grant**: any bypass of the content rules. The community must exist and be
  approved, the post kind must be allowed, duplicate and rate limits still apply, and
  moderation (report / remove) works on its posts like anyone else's. It is not an admin;
  it cannot moderate, ban, or configure anything.

The flag is `users.is_official`. It cannot be set through the app (a RESTRICTIVE RLS
policy forbids the app role from ever writing it, so no signed-in user, admin included,
can self-promote); only the owner-run step below sets it. This is deliberate (CLAUDE.md 8:
an authorization input must not be app-writable).

## 1. Create and promote the account

1. Decide the account (e.g. a shared `official@<campus>` Google identity) and **sign in
   with it once** on the tenant, so the user row and a membership exist. Verify it
   (domain or an admin) so it reads as a normal member apart from the badge.
2. Promote it (owner role, uses `MIGRATION_DATABASE_URL`), by its handle:

   ```bash
   pnpm official:promote -- --tenant <slug> --handle <Handle_1234>
   ```

   Idempotent. To revoke: add `--demote`. The badge and the posting power appear
   immediately; no deploy or restart.

## 2. Launch posts (announce each module)

Once promoted, the account posts announcements through the normal composer, no special
tooling: sign in as it and post one announcement per enabled module into the community
that best fits (a general/announcements community, or the module's own community if one
exists). Keep them short and honest ("Rides is live: offer a seat or find one"). Because
the account is official, the post is not blocked by that community's membership or gates.

## 3. Re-post lost/found and for-sale items (manual ops)

People post lost items and things for sale into community threads where they do not
belong. Moving them into the right module makes them findable and keeps the modules
useful. Do this by hand, judiciously, not in bulk:

1. Find a community post that is really a lost/found report or a for-sale listing.
2. As the official account, create the proper record: a Lost & Found item, or a
   marketplace listing, with the real details from the thread.
3. Link back: in the new record (and, if useful, as a reply on the original thread), point
   to the other, so nobody is misled about where it came from. Credit the original poster
   in plain words; do not impersonate them.
4. Leave the original thread in place. This is re-surfacing, not deletion.

Judgement rules: only re-post items that clearly belong in a module, keep the original
poster's meaning, never invent details, and stop if it starts to read as spam. The rate
limit still applies to the official account, which is a deliberate brake on doing this too
fast.

## Notes

- Demote (`--demote`) any account that should no longer be official; the badge and posting
  power are removed at once.
- The account is an ordinary account in every other respect: it can be reported, its posts
  removed, and it is bound by tenant isolation like anyone else.
