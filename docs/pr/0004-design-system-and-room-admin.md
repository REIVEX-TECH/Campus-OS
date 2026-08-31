# feat: design system + room-mapping admin

Targets `main`. One additive migration (`0002_room_source`), backwards compatible.

## What

Two parts: the platform's visual language, and the highest-value admin screen
(clearing room=TBA), built in that language as the proof it works.

### Part 1: design system (`packages/ui`, `docs/design.md`)

- **Documented visual law** in `docs/design.md`: a minimalist flat base,
  neumorphism only on interactive surfaces, static content flat and high
  contrast, with the WCAG ratios computed for every token pairing.
- **Tokens** (`packages/ui/src/styles/globals.css`): flat neutral base, a
  neumorphic `--surface` plus a per-mode `--shadow-raised` / `--shadow-pressed`
  pair, `--warning` for badges. **Dark mode is live** via `prefers-color-scheme`
  (it was defined but never activated). **The tenant accent is live**: injected
  server-side from `tenant.branding.colors.primary` on the tenant layout (no
  FOUC), with a luminance-derived readable foreground. Tenant agnostic.
- **Neumorphism stays AA** because text always sits on a solid token, never on a
  shadow. Computed ratios (see `docs/design.md`): lowest is white on the
  destructive red at 6.47:1; the tenant accent button is 7.95:1; neutral neu
  surfaces are 16 to 18:1. Every pairing clears AA, most clear AAA.
- **Components**: Button/Card gain the neumorphic affordance (interactive only);
  Table drops all divider lines (spacing only); Badge is flat and high contrast;
  new Input/Label/Select/Field primitives for the admin form.
- **Hard rule 1 (no dash punctuation)**: fixed every occurrence (the grid time
  range now reads "8:00 to 9:30" via a new i18n key; headings and ICS names
  restructured; section labels spaced). Enforced by `apps/web/test/no-dash.test.ts`
  (authoritative for `messages/*.ts`, plus em/en dashes in `app/`+`lib/`) and an
  ESLint `no-restricted-syntax` rule on JSX text (all three dash forms, no
  arithmetic false positives). The plain hyphen is kept (`multi-tenant`, `B-204`).
- **Hard rule 2 (no divider lines)**: removed the Table row/header borders and
  the empty-state dashed box; separation is whitespace only.

### Part 2: room-mapping admin (`/u/[slug]/admin/rooms`)

The fixture ingest leaves 41 entries at room=TBA because rooms are core-owned and
the sink flags unmapped room strings as pending. There was no back-link from an
entry to its raw room string, so this adds one and the resolve flow.

- **Migration `0002_room_source`**: adds nullable `timetable_entries.room_source`,
  populated by the sink from the raw room name. Excluded from `content_hash`
  (which hashes `room_id`), so populating it never churns versions.
- **Sink self-heal**: before flagging a room pending, the sink consults resolved
  aliases (`unmapped_source_values` where `kind='room'` and `status='resolved'`),
  so an admin's mapping survives the next crawl (this makes `resolved_id` live).
- **`AdminRoomsRepository`** (tenant-scoped, one transaction): `listPendingRooms`
  (with blocked-entry counts), `listRooms`, and `resolveRoom` (create or attach a
  canonical room, back-fill the blocked current entries in place with a recomputed
  `content_hash`, mark the value resolved). Filling a missing room is enrichment,
  not a schedule change, so rows update in place; the recomputed hash equals what
  the next ingest computes, so map-then-reingest is a no-op.
- **Admin UI** in the Part 1 language: neumorphic controls, flat cards, no dashes,
  no dividers, keyboard reachable, labelled. Goes through the repository layer
  only (no raw db client; respects the import guard).

## Authorization (how the gate is enforced)

A real server-side gate, a stopgap until the identity module (clearly commented):

- Env `ADMIN_SECRET` enables admin. If unset, admin **fails closed** (all access
  denied).
- `/u/[slug]/admin/login` exchanges the secret (constant-time compared) for an
  HttpOnly, SameSite=Lax, per-tenant **signed cookie** = HMAC-SHA256 of the tenant
  slug keyed by the secret. Cannot be forged without the secret; a token for one
  tenant does not authorize another.
- **Every admin page** calls `requireAdmin(slug)` (server component) which
  redirects unauthenticated visitors to login. **Every mutation** (`POST
/admin/rooms/resolve`, `/admin/login/submit`, `/admin/logout`) verifies the
  cookie server-side and returns 401 before touching the database. So the
  protection is not a hidden URL or a client-only control: the endpoint itself
  rejects unauthenticated requests. Login is rate limited.

## Data & migration impact

`0002_room_source`: `ALTER TABLE timetable_entries ADD COLUMN room_source text`
(nullable, additive, backwards compatible). Rollback: `DROP COLUMN room_source`.
Existing rows are repopulated on the next ingest.

## Tests

- Unit: `apps/web/test/admin-token.test.ts` (the authz gate: forged, wrong-tenant,
  wrong-secret, missing all rejected; valid accepted). `no-dash.test.ts`.
- Integration (`campusos_test`, `packages/modules/timetable`): resolve back-fills
  blocked entries and marks the value resolved; **map then re-ingest spawns no new
  versions (content_hash stable)**; alias self-heal on re-crawl; RLS isolation
  (resolving under one tenant leaves another untouched).
- E2E (`apps/web/e2e/admin-auth.spec.ts`): the admin **route** redirects an
  unauthenticated visitor, and the **mutation** endpoint returns 401 (not just the
  UI).

```bash
pnpm turbo run typecheck lint format:check build test   # all 22 tasks green
pnpm test:integration                                    # module + db integration
```

## Verification (room=TBA before / after)

Fixture ingest into `campusos_dev`, then map every pending room via the flow:

```
BEFORE: entries=41  room=TBA 41/41  pending rooms=15
mapped 15 rooms, resolved 41 entries
AFTER:  entries=41  room=TBA 0/41
```

## Follow-ups

- The admin authz is a shared-secret stopgap; the identity module will replace it
  with real accounts and roles. The rate limiter is in-process (single instance).
- Generalize the resolver to other unmapped kinds (teacher, section, term).
- A theme toggle (dark mode currently follows the system preference only).
