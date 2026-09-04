# docs: governance addendum, roles, karma, gates and restrictions

## What

The governance addendum applied to both design documents: who may define a role
against who may assign one, a default membership for everyone who signs in with
verification layered on top, karma and its anti-gaming rules, per-community
participation gates with a tenant floor, and tenant-level restriction and
suspension with an appeal path. Two new platform phases and a new communities
phase C carry the work; nothing is built in this PR.

## Why

Design first, as every phase in this project has been. Three of the items are
security changes to powers that already exist, and one of them closes a hole
that is live today, so they are worth writing down and reviewing before they are
written in code.

## How

### `docs/design-platform-admin.md`

- **§2 gains "Definitions and assignments are different powers".** Today
  `manage-roles` carries both, and that is an escalation hole rather than a
  convenience: a tenant administrator can create a role carrying
  `communities.unmask`, which the catalogue gives to nobody by default, and
  grant it to themselves. Nothing compares a new role against the granter.
  Definitions become platform-level templates (`role_templates`,
  `role_template_permissions`, no `tenant_id`) edited on the platform host,
  which has no tenant context and so needs no Phase 5 grant; each tenant's
  `roles` rows become materialisations of them, and the permission checks on
  the hot path do not change at all. Assignment gains the missing rule: nobody
  may grant a power they do not have.
- **The catalogue changes.** `manage-roles` narrows to assigning and revoking;
  `manage-members` narrows to viewing the list; `restrict-members` is new.
- **§6 is new: membership, restriction and suspension.** Role, verification and
  standing are three separate things about a person. Everyone who signs in gets
  `student` on that tenant, not only addresses on the domain list; verification
  is what posting waits for. Standing becomes `active`, `restricted` (read
  only) and `suspended` (cannot sign in), each with a reason, an actor and an
  expiry, each audited, each reversible, and none of them ever applied
  silently.
- **§7 Phases** adds 6 (definitions) and 7 (membership and standing), with a
  note that neither waits for Phase 5.

### `docs/design-communities.md`

- **§11 Karma** is new: what accrues and what deliberately does not, the four
  anti-gaming rules, and the reason the public total excludes anonymous items
  while the private one includes them (a displayed number that moves with an
  anonymous post's score is a channel that names its author). Post and comment
  karma stored apart, shown together, cached in `community_karma` and
  recomputable from the vote tables.
- **§12 Participation gates** is new: five per-community settings, a tenant
  floor a community may tighten and never loosen, account age measured from
  the account's creation and never from time spent, and refusals that carry the
  number they are about.
- **§13 Restrictions, suspensions and reporting a person** is new: what a
  restricted member experiences in this module, `reports.item_type = 'user'`
  into the tenant-wide queue that already exists, the repeated-report flag, and
  the rule that nothing is shadow-applied.
- **§3** records that definitions are not a tenant's to edit. **§4** gains the
  karma cap and the three floor settings. **§14 Deferred** gains soft account
  deletion and export-my-data. **§15 Phases** gains phase C.
- Sections 11 to 13 renumber to 14 to 16; the two references in
  `docs/communities-status.md` follow.

### Which phase absorbs which addendum item

| Addendum item                             | Phase                       |
| ----------------------------------------- | --------------------------- |
| 1 Super admin defines roles               | Platform 6                  |
| 2 Tenant admin assigns only, no upward    | Platform 6                  |
| 3 Default student role, verification atop | Platform 7                  |
| 4 Karma                                   | Communities C1              |
| 5 Participation gates                     | Communities C2              |
| 6 Restrict, suspend, report a user        | Platform 7 + Communities C3 |
| 7 Reddit parity, no shadow, deletion      | Platform 7, deferred §14    |

## Security

No code and no schema in this PR. The design records one live hole (a tenant
administrator can mint and grant `communities.unmask` today) and one live
misfeature (an address off the domain list gets no membership at all, so the
person cannot even reach the page that would let them request verification).
Both are fixed by phases 6 and 7 respectively, and both get permission-boundary
tests there.

## Tests

None: documentation only. The tests each phase must add are named in the phase
descriptions, and the addendum's six boundaries map to them: a tenant admin
cannot edit a role definition (6), cannot grant above themselves (6), a student
default is read-only until verified (7), an unverified member cannot post (7),
a karma gate blocks and then admits (C2), a restricted member cannot post (C3),
a suspended member cannot sign in (7).

## Verification steps

Read both documents. `pnpm exec prettier --check docs/` passes.

## Migration notes

No schema change.

## Breaking changes

None.

## Follow-ups

- Phases 6, 7 and C1 to C3 are the follow-up pull requests, in that dependency
  order; C1 and C2 need nothing from the platform phases.
- Node's nvm shim (`C:\nvm4w\nodejs`) is empty on this machine, so the
  toolchain runs from `AppData\Local\nvm\v24.15.0` directly. Unrelated to this
  change, worth a `nvm use 24.15.0`.
