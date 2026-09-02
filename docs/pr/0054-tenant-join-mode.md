# feat(core): tenant join mode setting

Targets `main`. Adds the approved per tenant `joinMode` to the tenant model.
Additive and inert: nothing reads it yet, and no behaviour changes.

## What

`joinMode` is `domain` or `invite`, defaulting to `domain`.

- `domain` lets anyone with a verified email on the tenant's
  `allowedEmailDomains` join as a student with no admin involvement, which is
  what a university with one well known address space wants.
- `invite` requires a tenant admin to invite each member, for a tenant that
  would rather approve who gets in.

LGU sets `domain` explicitly rather than leaning on the default, so the intent is
visible in its config next to `allowedEmailDomains`.

Membership does not exist yet, so nothing enforces this. It lands now because the
approved decision was that self join is a per tenant setting rather than a
platform rule, and it is cheaper to have the field in the model from the start
than to add it once tenants exist in the database.

## Data & migration impact

No schema change. This is the file backed tenant config, validated by the same
zod schema that will validate the database backed one, so the field carries over
unchanged when tenant config moves to the database.

## Tests

- Unit (3 new, 16 total in core): the default is `domain`, `invite` parses, and
  anything else is rejected rather than silently accepted.
- `pnpm turbo run typecheck lint build test` (24 tasks) and
  `pnpm --filter web test:e2e` (33) pass.

## Verification steps

`pnpm --filter @campusos/core test`. A tenant config without `joinMode` parses
with `domain`; `joinMode: 'anyone'` throws.

## Follow-ups

- Enforcement belongs with membership, in the identity sequence.
