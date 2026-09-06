# Security backlog

Known security findings that are **not** live escalations, deferred behind feature
work. Policy: only a live escalation is fixed ahead of feature work; everything
else is recorded here by severity and picked up deliberately. New findings from
any review land here rather than triggering an immediate fix or an unprompted
review pass.

Severity: **High** (real, reachable escalation/leak) · **Medium** (latent —
reachable only via a code path that does not yet exist, or a defense-in-depth gap)
· **Low** (hygiene).

---

## Medium

### M2 — standing moderation text is tenant-wide readable under RLS

- **Where:** `tenant_memberships.standing_reason`, `tenant_memberships.appeal_note`
  (identity `0014`). The `memberships_read` policy is tenant-wide (`user_id =
app.user_id OR tenant_id = app.tenant_id`), so any session the app places in the
  tenant's context can read these columns; only the readers holding
  `restrict-members` are meant to. Moderation text (why a member was
  restricted/suspended) and their appeal (often personal) sit on the row.
- **Why not live:** no in-tree query selects them un-gated today —
  `standingFor` reads own-row, `listStandings` gates on `restrict-members`, the
  standing notice shows the member their own. A _new_ un-gated reader would leak;
  the bridge test `apps/web/test/standing-columns-gated.test.ts` guards that until
  this lands.
- **Agreed fix (Group A, the M1 / 0030 shape):** move both columns to
  `membership_standing_details` (own-row RLS for the member, NO FORCE); admin reads
  via a definer `auth_standings_for_tenant` gated on `restrict-members` through
  `auth_effective_permissions`; writes via the rewritten `auth_write_standing` /
  `auth_appeal_standing`. **Carry-over semantics (decided):** the detail row exists
  while the membership is under a non-active standing; a new decision sets the
  reason and clears any pending appeal; reinstatement deletes the row — so an
  appeal note survives exactly as long as the standing it appeals. Migrate existing
  rows, drop the columns, and retire the bridge test's allowlist to the new
  readers. §6 the definers.
- **Explicitly out of scope (decided):** `verified_at` / `verification_method` stay
  on `tenant_memberships` — a low-sensitivity gate signal read cross-module
  (`communities/src/access.ts`) and on every `isVerified`; splitting them would
  ripple across modules for little gain.
- **Draft:** a complete migration is drafted on branch
  `fix/membership-standing-details` (`0031_membership_standing_details.sql`, no
  journal entry yet so it is inert). Resume from there: add the journal entry, the
  schema table, the `standing.ts` reader/writer changes, tests, and the bridge-test
  allowlist update.

---

## Low

### standing reason retained in `audit_log.meta`

- **Where:** `auth_write_standing` writes `meta.reason` (the moderation reason) into
  `audit_log`, whose policy is tenant-wide (`tenant_id = app.tenant_id OR
actor_user_id = app.user_id`). So the reason is also readable by any session in
  the tenant's context, the same class as M2.
- **Why kept:** `audit_log` is the append-only accountability record, intended for
  administrators and the actor; the reason is the point of the entry. Revisit only
  if the audit trail is ever surfaced to non-administrators, or as part of a
  broader audit-access review.

### `view-member-identity` reachable by a platform admin under a grant

- **Where:** `auth_member_identity` (0031, Block 1.5a) gates on
  `view-member-identity`, which the grant branch of `auth_effective_permissions`
  grants a platform admin under a live grant (it resolves to the tenant_admin set
  minus `communities.unmask`).
- **Why kept (decided):** revealing a member's real identity is administrative
  tooling, not a content-anonymity break like `unmask`; platform admins are the
  platform's operators and every reveal is audited with the actor. So it is
  deliberately NOT excluded, which also kept 1.5a off the high-blast-radius
  `auth_effective_permissions`.
- **The flip, if wanted:** to make reveal resident-admin-only, add
  `AND rp.permission <> 'view-member-identity'` to the grant branch (a new
  `auth_effective_permissions` version, alongside the existing unmask exclusion).
  One migration; §6 it.

### migration-number collision to avoid when M2 resumes

- The M2 draft above names `0031_membership_standing_details.sql`, but Block 1.5a
  has now landed `0031_member_identity.sql` (journal idx 31) on main. When M2
  resumes, renumber its file to the next free number (0032+) and journal it there;
  `0031` is taken.
