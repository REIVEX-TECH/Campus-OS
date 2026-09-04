import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  withActor,
  withActorInTenant,
  withGrantedTenant,
  withPlatformGrant,
  withTenant,
} from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { universities } from '@campusos/db/schema';
import { migrationsFolder, migrationsTable } from '../src/manifest';
import {
  auditLog,
  membershipRoles,
  platformRoles,
  rolePermissions,
  roles,
  sessions,
  tenantConfigs,
  tenantMemberships,
  userRecents,
  users,
  verificationRequests,
} from '../src/schema/identity';
import { findOrCreateUser, issueSession, resolveSession, revokeSession } from '../src/sessions';
import { changeHandle, chooseAvatar } from '../src/handles/service';
import { HANDLE_PATTERN } from '../src/handles/handle';
import {
  ensureConfiguredAdmin,
  ensureDomainMembership,
  isVerified,
  membershipFor,
} from '../src/membership';
import {
  can,
  effectivePermissions,
  grantRole,
  listRoles,
  revokeRole,
  rolesForMember,
} from '../src/rbac';
import { listMembers } from '../src/members';
import { appeal, listStandings, liftStanding, setStanding, standingFor } from '../src/standing';
import { tenantActivity } from '../src/analytics';
import { ensurePlatformAdmin, isPlatformAdmin } from '../src/platform';
import {
  createRoleTemplate,
  deleteRoleTemplate,
  listRoleTemplates,
  setRoleTemplatePermissions,
} from '../src/role-templates';
import { createTenant, listTenantConfigs, updateTenantConfig } from '../src/tenants';
import {
  decideRequest,
  latestRequest,
  listPendingRequests,
  requestVerification,
  userIdByHandle,
  verifyMember,
} from '../src/verification';
import { clearRecents, listRecents, recordRecent } from '../src/recents';

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder, migrationsTable);

  // Several assertions below only hold once the application role and the schema
  // owner are different roles (docs/db-role-split.md). While the application
  // still owns the tables it bypasses RLS wherever FORCE is absent, so a pass
  // here would prove nothing. Fail loudly, and say what to do about it, rather
  // than reporting green against a database that cannot honour the guarantee.
  const [ownership] = [
    ...(await getDb().execute(sql`
      select pg_get_userbyid(relowner) = current_user as app_owns_sessions
      from pg_class
      where relname = 'sessions'
    `)),
  ];
  if (ownership?.app_owns_sessions) {
    throw new Error(
      'This database has not been split: the application role still owns the tables. ' +
        'Run scripts/db-bootstrap.sql for a fresh database, or docs/db-role-split.md for ' +
        'an existing one, then point MIGRATION_DATABASE_URL at the owner role.',
    );
  }
});

afterAll(async () => {
  await getSqlClient().end();
});

/**
 * A user row is created by generating its id first, then inserting under that
 * actor context. RLS is strict enough that a row must claim its own identity to
 * exist, which is the property these tests are here to hold onto.
 */
async function createUser(email: string, handle: string): Promise<string> {
  const id = randomUUID();
  await withActor(id, async (tx) => {
    await tx.insert(users).values({
      id,
      googleSub: `sub-${id}`,
      email,
      emailVerifiedAt: new Date(),
      handle,
      avatarSeed: id,
    });
  });
  return id;
}

let alice: string;
let bob: string;

beforeEach(async () => {
  await runAsMigrationRole(`truncate table "users" restart identity cascade`);
  await runAsMigrationRole(`truncate table "audit_log" restart identity cascade`);
  await runAsMigrationRole(`truncate table "universities" restart identity cascade`);
  // Definitions have no tenant, so the truncate above does not reach them: one
  // another run added would still be here and would make a create report
  // `exists`. The six system ones are seeded by the migration and stay.
  await runAsMigrationRole(`delete from "role_templates" where "is_system" = false`);
  // universities is platform-admin-write under RLS (0017), so the app role the
  // suite runs as cannot insert it; the owner seeds it, as with the truncate.
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values
       ('aaa','Alpha U','Asia/Karachi'), ('bbb','Beta U','Asia/Karachi')
     on conflict ("slug") do nothing`,
  );
  alice = await createUser('alice@aaa.edu', 'Brave_Otter_1234');
  bob = await createUser('bob@bbb.edu', 'Calm_Heron_5678');
});

describe('users', () => {
  it('lets a user read their own row', async () => {
    const rows = await withActor(alice, (tx) => tx.select().from(users));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(alice);
  });

  it('never shows one user the row of another', async () => {
    const rows = await withActor(bob, (tx) => tx.select().from(users));
    expect(rows.map((r) => r.id)).toEqual([bob]);
  });

  it('returns nothing with no actor context: default deny', async () => {
    const rows = await getDb().select().from(users);
    expect(rows).toEqual([]);
  });

  it('refuses to write a row claiming another identity', async () => {
    await expect(
      withActor(alice, (tx) =>
        tx.insert(users).values({
          id: randomUUID(),
          googleSub: 'sub-forged',
          email: 'forged@aaa.edu',
          emailVerifiedAt: new Date(),
          handle: 'Forged_Name_0001',
          avatarSeed: 'x',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('sessions', () => {
  it('are visible only to the user they belong to', async () => {
    await withActor(alice, (tx) =>
      tx.insert(sessions).values({
        userId: alice,
        tokenHash: 'hash-alice',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    expect(await withActor(alice, (tx) => tx.select().from(sessions))).toHaveLength(1);
    expect(await withActor(bob, (tx) => tx.select().from(sessions))).toHaveLength(0);
  });
});

describe('auth_resolve_session', () => {
  // The one privileged read in the system. It exists because resolving a
  // request's session happens before the user is known: we hold a token, not a
  // user id, so it cannot satisfy the own-row policy on sessions.
  it('resolves a live token with no actor context, and only on an exact match', async () => {
    await withActor(alice, (tx) =>
      tx.insert(sessions).values({
        userId: alice,
        tokenHash: 'live-hash',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const hit = [...(await getDb().execute(sql`select * from auth_resolve_session('live-hash')`))];
    expect(hit).toHaveLength(1);
    expect(hit[0]!.user_id).toBe(alice);

    // Without the exact hash of a live token it returns nothing, so it cannot
    // be used to enumerate sessions.
    const miss = [
      ...(await getDb().execute(sql`select * from auth_resolve_session('not-a-hash')`)),
    ];
    expect(miss).toHaveLength(0);
  });

  it('ignores an expired or revoked session', async () => {
    await withActor(alice, (tx) =>
      tx.insert(sessions).values([
        { userId: alice, tokenHash: 'expired', expiresAt: new Date(Date.now() - 1000) },
        {
          userId: alice,
          tokenHash: 'revoked',
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
        },
      ]),
    );
    const expired = [
      ...(await getDb().execute(sql`select * from auth_resolve_session('expired')`)),
    ];
    const revoked = [
      ...(await getDb().execute(sql`select * from auth_resolve_session('revoked')`)),
    ];
    expect(expired).toHaveLength(0);
    expect(revoked).toHaveLength(0);
  });

  it('still does not let the application read the sessions table directly', async () => {
    await withActor(alice, (tx) =>
      tx.insert(sessions).values({
        userId: alice,
        tokenHash: 'private',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    // Dropping FORCE on sessions let the OWNER read it, for the definer
    // function. The application owns nothing, so the own-row policy still binds.
    expect(await withActor(bob, (tx) => tx.select().from(sessions))).toHaveLength(0);
    expect(await getDb().select().from(sessions)).toEqual([]);
  });
});

describe('tenant_memberships', () => {
  beforeEach(async () => {
    // Memberships are written in a tenant context (0008): a person can read
    // the ones they hold but never write one themselves.
    await withActorInTenant(alice, 'aaa', (tx) =>
      tx.insert(tenantMemberships).values({ tenantId: 'aaa', userId: alice, role: 'student' }),
    );
    await withActorInTenant(alice, 'bbb', (tx) =>
      tx.insert(tenantMemberships).values({ tenantId: 'bbb', userId: alice, role: 'teacher' }),
    );
    await withActorInTenant(bob, 'bbb', (tx) =>
      tx.insert(tenantMemberships).values({ tenantId: 'bbb', userId: bob, role: 'student' }),
    );
  });

  it('shows a user every tenant they belong to, before a tenant is chosen', async () => {
    const rows = await withActor(alice, (tx) => tx.select().from(tenantMemberships));
    expect(rows.map((r) => r.tenantId).sort()).toEqual(['aaa', 'bbb']);
  });

  it('shows a tenant its own members, inside a tenant context', async () => {
    const rows = await withTenant('bbb', (tx) => tx.select().from(tenantMemberships));
    expect(rows.map((r) => r.userId).sort()).toEqual([alice, bob].sort());
  });

  it('never leaks the members of one tenant to another', async () => {
    const rows = await withTenant('aaa', (tx) => tx.select().from(tenantMemberships));
    expect(rows.map((r) => r.userId)).toEqual([alice]);
  });

  it('gives a signed in user in one tenant both their own rows and that tenant', async () => {
    const rows = await withActorInTenant(bob, 'bbb', (tx) => tx.select().from(tenantMemberships));
    expect(rows).toHaveLength(2);
  });

  it('never lets a person write their own membership', async () => {
    // This is what makes "verified" unforgeable rather than merely hidden: no
    // path a user controls can satisfy WITH CHECK on this table.
    await expect(
      withActor(bob, (tx) =>
        tx.insert(tenantMemberships).values({ tenantId: 'aaa', userId: bob, role: 'student' }),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withActor(bob, (tx) =>
        tx
          .update(tenantMemberships)
          .set({ verifiedAt: new Date(), verificationMethod: 'admin' })
          .where(eq(tenantMemberships.userId, bob)),
      ),
    ).resolves.toBeDefined();
    // An update the policy hides simply matches nothing, so it must have
    // changed nothing either.
    const [row] = await withActor(bob, (tx) => tx.select().from(tenantMemberships));
    expect(row!.verifiedAt).toBeNull();
  });
});

describe('sign in lifecycle', () => {
  const identity = { subject: 'google-sub-1', email: 'new@aaa.edu' };

  it('creates a user on first sign in and finds the same one after', async () => {
    const first = await findOrCreateUser(identity);
    expect(first.email).toBe(identity.email);
    // A real generated handle from the first sign in, not a placeholder.
    expect(first.handle).toMatch(HANDLE_PATTERN);

    const second = await findOrCreateUser(identity);
    expect(second.userId).toBe(first.userId);
  });

  it('follows the provider subject when the email changes upstream', async () => {
    const before = await findOrCreateUser(identity);
    const after = await findOrCreateUser({ subject: identity.subject, email: 'moved@aaa.edu' });
    expect(after.userId).toBe(before.userId);
    expect(after.email).toBe('moved@aaa.edu');
  });

  it('issues a session that resolves back to its user', async () => {
    const actor = await findOrCreateUser(identity);
    const session = await issueSession(actor);
    const resolved = await resolveSession(session.token);
    expect(resolved?.userId).toBe(actor.userId);
  });

  it('does not resolve an unknown token', async () => {
    expect(await resolveSession('not-a-real-token')).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
  });

  it('stops working the moment it is revoked', async () => {
    const actor = await findOrCreateUser(identity);
    const session = await issueSession(actor);
    expect(await resolveSession(session.token)).not.toBeNull();

    await revokeSession(session.token);
    // Signing out is server side, so the token is dead everywhere at once
    // rather than merely forgotten by one browser.
    expect(await resolveSession(session.token)).toBeNull();
  });

  it('stores only a hash, so the table never holds a usable token', async () => {
    const actor = await findOrCreateUser(identity);
    const session = await issueSession(actor);
    const [row] = await withActor(actor.userId, (tx) => tx.select().from(sessions));
    expect(row!.tokenHash).not.toBe(session.token);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('handles', () => {
  const identity = { subject: 'handle-sub', email: 'handles@aaa.edu' };

  it('gives a new user a generated handle, not a placeholder', async () => {
    const actor = await findOrCreateUser(identity);
    expect(actor.handle).toMatch(HANDLE_PATTERN);
  });

  it('lets a user choose a new handle and remembers when', async () => {
    const actor = await findOrCreateUser(identity);
    const result = await changeHandle(actor.userId, 'Quiet_Harbour_7');
    expect(result).toEqual({ ok: true, handle: 'Quiet_Harbour_7' });

    const again = await findOrCreateUser(identity);
    expect(again.handle).toBe('Quiet_Harbour_7');
    expect(again.handleChangedAt).not.toBeNull();
  });

  it('refuses a second change inside the cooldown', async () => {
    const actor = await findOrCreateUser(identity);
    await changeHandle(actor.userId, 'Quiet_Harbour_7');
    const second = await changeHandle(actor.userId, 'Other_Name_9');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('too_soon');
  });

  it('refuses a handle already held by someone else', async () => {
    const a = await findOrCreateUser(identity);
    const b = await findOrCreateUser({ subject: 'other-sub', email: 'other@aaa.edu' });
    await changeHandle(a.userId, 'Shared_Name_1');
    const clash = await changeHandle(b.userId, 'Shared_Name_1');
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.reason).toBe('taken');
  });

  it('reserves a released handle so it cannot be used to impersonate', async () => {
    const a = await findOrCreateUser(identity);
    const original = a.handle;
    await changeHandle(a.userId, 'Moved_Away_2');

    // Someone else cannot pick up the name the first user has just left.
    const b = await findOrCreateUser({ subject: 'squatter-sub', email: 'squatter@aaa.edu' });
    const attempt = await changeHandle(b.userId, original);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.reason).toBe('taken');
  });

  it('treats asking for the handle you already hold as a no-op', async () => {
    const actor = await findOrCreateUser(identity);
    const result = await changeHandle(actor.userId, actor.handle);
    expect(result).toEqual({ ok: true, handle: actor.handle });
    // It must not burn the cooldown, or a stray save would lock someone out.
    const after = await changeHandle(actor.userId, 'Really_New_3');
    expect(after.ok).toBe(true);
  });

  it('re rolls an avatar without touching the handle', async () => {
    const actor = await findOrCreateUser(identity);
    const seed = await chooseAvatar(actor.userId, 3);
    expect(seed).not.toBe(actor.avatarSeed);
    // The avatar route only draws seeds of this shape (apps/web/lib/avatar.ts).
    expect(seed).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect((await findOrCreateUser(identity)).handle).toBe(actor.handle);
  });

  it('shows the public profile without ever exposing an email', async () => {
    const actor = await findOrCreateUser(identity);
    const rows = [
      ...(await getDb().execute(
        sql`select * from public_profiles where user_id = ${actor.userId}::uuid`,
      )),
    ];
    expect(rows).toHaveLength(1);
    // The protection is structural: email is not a column of the view, so no
    // query against it can select one.
    expect(Object.keys(rows[0]!)).toEqual(['user_id', 'handle', 'avatar_seed']);
  });
});

describe('platform_roles', () => {
  it('cannot be written directly by the application role, only read as oneself', async () => {
    // Hole closed (0016): the row policy is SELECT-only, so a signed-in request
    // cannot write itself a platform-admin row. Before this the FOR ALL policy
    // let `user_id = app.user_id` through, and only TypeScript stood between a
    // stray insert and god-mode.
    await expect(
      withActor(alice, (tx) =>
        tx.insert(platformRoles).values({ userId: alice, role: 'platform_admin' }),
      ),
    ).rejects.toThrow();
    // Still nobody, because the write did not happen.
    expect(await withActor(alice, (tx) => tx.select().from(platformRoles))).toHaveLength(0);
  });

  it('are granted only by the definer, only to the caller, only if allowlisted', async () => {
    const grant = (userId: string, list: string[]) =>
      withActor(userId, async (tx) => {
        const [row] = [
          ...(await tx.execute(
            sql`select auth_grant_platform_admin(
                  ${
                    list.length === 0
                      ? sql`array[]::text[]`
                      : sql`array[${sql.join(
                          list.map((e) => sql`${e}`),
                          sql`, `,
                        )}]::text[]`
                  }
                ) as granted`,
          )),
        ] as { granted: boolean }[];
        return row?.granted === true;
      });

    // An empty allowlist promotes nobody: fail closed, no first-user fallback.
    expect(await grant(alice, [])).toBe(false);
    // A junk entry is not a wildcard, even one that contains an '@'.
    expect(await grant(alice, ['@', 'x@', alice + '-not'])).toBe(false);
    // An address that is not the caller's does not promote the caller.
    expect(await grant(alice, ['bob@bbb.edu'])).toBe(false);
    expect(await withActor(alice, (tx) => tx.select().from(platformRoles))).toHaveLength(0);

    // The caller's own verified email, on the list, promotes them once.
    expect(await grant(alice, ['ALICE@aaa.edu'])).toBe(true);
    expect(await grant(alice, ['alice@aaa.edu'])).toBe(false); // already one; nothing written
    // Visible only to the holder, as before.
    expect(await withActor(alice, (tx) => tx.select().from(platformRoles))).toHaveLength(1);
    expect(await withActor(bob, (tx) => tx.select().from(platformRoles))).toHaveLength(0);
    expect(await isPlatformAdmin(alice)).toBe(true);
    expect(await isPlatformAdmin(bob)).toBe(false);

    // The grant wrote its own audit line, in the same statement.
    const log = await withActor(alice, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, 'platform.admin_granted')),
    );
    expect(log).toHaveLength(1);
    expect(log[0]!.actorUserId).toBe(alice);
  });
});

describe('audit_log', () => {
  it('accepts appends and shows them inside the tenant they touched', async () => {
    await withActor(alice, (tx) =>
      tx.insert(auditLog).values({ actorUserId: alice, tenantId: 'aaa', action: 'room.rename' }),
    );
    const inTenant = await withTenant('aaa', (tx) => tx.select().from(auditLog));
    expect(inTenant).toHaveLength(1);
    // A tenant admin can see who acted in their tenant, which is the point.
    expect(inTenant[0]!.action).toBe('room.rename');
    expect(await withTenant('bbb', (tx) => tx.select().from(auditLog))).toHaveLength(0);
  });

  it('cannot be rewritten or erased', async () => {
    await withActor(alice, (tx) =>
      tx
        .insert(auditLog)
        .values({ actorUserId: alice, tenantId: 'aaa', action: 'admin.tenant.enter' }),
    );
    // No UPDATE or DELETE policy exists, and a trigger raises besides, so
    // history survives either way.
    await withTenant('aaa', async (tx) => {
      await tx.execute(sql`update audit_log set action = 'tampered'`).catch(() => undefined);
      await tx.execute(sql`delete from audit_log`).catch(() => undefined);
    });
    const after = await withTenant('aaa', (tx) => tx.select().from(auditLog));
    expect(after).toHaveLength(1);
    expect(after[0]!.action).toBe('admin.tenant.enter');
  });
});

describe('row security invariants', () => {
  /**
   * The exact FORCE state of every identity table, pinned deliberately.
   *
   * FORCE applies a table's policies to its OWNER as well as everyone else. That
   * is what a SECURITY DEFINER function runs as, so a table with FORCE is one no
   * definer function can read: it gets filtered exactly as the caller would be,
   * returns nothing, and the check it was written to perform silently passes.
   *
   * That failure is quiet, which is the problem. It cost three separate fixes
   * here, once per table, each found only after the feature above it had been
   * written. So the state is asserted rather than remembered: adding a table, or
   * a definer function that reads one, fails this test until the choice is made
   * on purpose.
   *
   * RLS itself is on everywhere and stays on. FORCE is dropped ONLY where a
   * definer function needs to read, and the application role owns nothing, so
   * dropping it changes nothing the application can see.
   */
  const FORCED: Record<string, boolean> = {
    // Read by a definer function, so FORCE must be off.
    users: false, // auth_resolve_user_by_subject, public_profiles
    sessions: false, // auth_resolve_session
    handle_history: false, // auth_handle_is_reserved
    // Never read by one. FORCE stays on as a safety net if the application is
    // ever pointed at the owner credential by mistake.
    // Joined by auth_effective_permissions, so FORCE must stay off here too.
    tenant_memberships: false,
    // Written by auth_grant_platform_admin, a definer, so FORCE is off (0016):
    // the app role is a non-owner and still bound to the SELECT-only policy, so
    // it cannot write the table; the owner (the definer) can.
    platform_roles: false,
    audit_log: true,
    user_recents: true,
    verification_requests: true,
    // Read by auth_effective_permissions, so FORCE must stay off.
    roles: false,
    role_permissions: false,
    membership_roles: false,
    // Base schema, written by the owner in the sync script and by a platform
    // admin under policies; never read by a definer function. No FORCE so the
    // owner can write it; the application owns nothing, so RLS binds it anyway.
    tenant_configs: false,
    // Read by the grant definers (0018) as the owner, so FORCE must be off, or
    // auth_under_tenant_grant and the resolver would see nothing and the
    // subtraction would fail OPEN. The app cannot write them: the uses table has
    // no policy and the grants table's writes are revoked from the app role.
    platform_tenant_grants: false,
    platform_grant_uses: false,
  };

  it('keeps RLS on every table, and drops FORCE only where a definer function reads', async () => {
    const rows = [
      ...(await getDb().execute(
        sql`select relname, relrowsecurity, relforcerowsecurity
            from pg_class
            where relname in (${sql.join(
              Object.keys(FORCED).map((t) => sql`${t}`),
              sql`, `,
            )})
              and relkind = 'r'`,
      )),
    ] as { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[];

    expect(rows).toHaveLength(Object.keys(FORCED).length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} FORCE state changed`).toBe(
        FORCED[row.relname],
      );
    }
  });
});

describe('membership by domain', () => {
  const policy = { slug: 'aaa', joinMode: 'domain' as const, allowedEmailDomains: ['aaa.edu'] };

  it('makes a person on the domain a verified student, silently', async () => {
    const actor = await findOrCreateUser({ subject: 'dom-1', email: 'student@aaa.edu' });
    const membership = await ensureDomainMembership(actor, policy);
    expect(membership).toMatchObject({
      tenantId: 'aaa',
      role: 'student',
      status: 'active',
      verificationMethod: 'domain',
    });
    expect(membership!.verifiedAt).toBeInstanceOf(Date);
    // Visible to the person themselves, and only as themselves.
    expect(await membershipFor(actor.userId, 'aaa')).toMatchObject({ id: membership!.id });
    expect(await membershipFor(actor.userId, 'bbb')).toBeNull();
  });

  it('makes anyone else a student too, but unverified', async () => {
    const actor = await findOrCreateUser({ subject: 'dom-2', email: 'someone@gmail.com' });
    const membership = await ensureDomainMembership(actor, policy);
    // The floor everyone stands on: a place to read from and to ask from.
    // Before this an address off the list got nothing, which left the person
    // unable to reach the page that would have let them ask to be verified.
    expect(membership).toMatchObject({
      tenantId: 'aaa',
      role: 'student',
      status: 'active',
      verifiedAt: null,
      verificationMethod: null,
    });
    expect(isVerified(membership)).toBe(false);
    expect(await membershipFor(actor.userId, 'aaa')).toMatchObject({ id: membership!.id });
    // And it grants nothing anywhere else.
    expect(await membershipFor(actor.userId, 'bbb')).toBeNull();
  });

  it('does the same for a tenant that joins by invitation', async () => {
    // An invitation decides who is verified, not who may read: the same
    // address on the domain list is still unverified here, because this
    // tenant does not verify by domain at all.
    const actor = await findOrCreateUser({ subject: 'dom-3', email: 'student@aaa.edu' });
    expect(await ensureDomainMembership(actor, { ...policy, joinMode: 'invite' })).toMatchObject({
      role: 'student',
      verifiedAt: null,
    });
  });

  it('is idempotent across sign ins', async () => {
    const actor = await findOrCreateUser({ subject: 'dom-4', email: 'again@aaa.edu' });
    const first = await ensureDomainMembership(actor, policy);
    const second = await ensureDomainMembership(actor, policy);
    expect(second!.id).toBe(first!.id);
    expect(second!.verifiedAt!.getTime()).toBe(first!.verifiedAt!.getTime());
    const rows = await withActor(actor.userId, (tx) => tx.select().from(tenantMemberships));
    expect(rows).toHaveLength(1);
  });

  it('verifies an existing unverified membership rather than duplicating it', async () => {
    const actor = await findOrCreateUser({ subject: 'dom-5', email: 'late@aaa.edu' });
    await withActorInTenant(actor.userId, 'aaa', (tx) =>
      tx
        .insert(tenantMemberships)
        .values({ tenantId: 'aaa', userId: actor.userId, role: 'student' }),
    );
    const membership = await ensureDomainMembership(actor, policy);
    expect(membership!.verificationMethod).toBe('domain');
    expect(membership!.verifiedAt).toBeInstanceOf(Date);
  });

  it('leaves the audit trail the design asks for', async () => {
    const actor = await findOrCreateUser({ subject: 'dom-6', email: 'trail@aaa.edu' });
    await ensureDomainMembership(actor, policy);
    const rows = await withActorInTenant(actor.userId, 'aaa', (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.actorUserId, actor.userId)),
    );
    expect(rows.map((r) => r.action)).toContain('membership.joined');
    // Ids and enum values only, never an address. (The id is a bigint, which
    // JSON cannot carry, so only the fields that could hold text are checked.)
    const text = JSON.stringify(
      rows.map((r) => [r.action, r.targetType, r.targetId, r.tenantId, r.meta]),
    );
    expect(text).not.toContain('@');
  });
});

describe('user_recents', () => {
  it('remembers, newest first, one per key, and only for its owner', async () => {
    const actor = await findOrCreateUser({ subject: 'rec-1', email: 'rec@aaa.edu' });
    const other = await findOrCreateUser({ subject: 'rec-2', email: 'other@aaa.edu' });
    await recordRecent(actor.userId, 'aaa', {
      kind: 'section',
      key: 's1',
      label: 'BSCS 1A',
      href: '/u/aaa/timetable?section=s1',
    });
    await recordRecent(actor.userId, 'aaa', {
      kind: 'teacher',
      key: 't1',
      label: 'Someone',
      href: '/u/aaa/teachers/t1',
    });
    await recordRecent(actor.userId, 'aaa', {
      kind: 'section',
      key: 's1',
      label: 'BSCS 1A (renamed)',
      href: '/u/aaa/timetable?section=s1',
    });
    const items = await listRecents(actor.userId, 'aaa');
    expect(items.map((i) => i.key)).toEqual(['s1', 't1']);
    expect(items[0]!.label).toBe('BSCS 1A (renamed)');
    expect(await listRecents(other.userId, 'aaa')).toEqual([]);
    expect(await withActor(other.userId, (tx) => tx.select().from(userRecents))).toEqual([]);
  });

  it('can be cleared by its owner', async () => {
    const actor = await findOrCreateUser({ subject: 'rec-3', email: 'clear@aaa.edu' });
    await recordRecent(actor.userId, 'aaa', {
      kind: 'room',
      key: 'r1',
      label: 'B-204',
      href: '/x',
    });
    await clearRecents(actor.userId, 'aaa');
    expect(await listRecents(actor.userId, 'aaa')).toEqual([]);
  });
});

const details = { fullName: 'Ayesha Khan', rollNumber: 'FA21-042', note: undefined };

/** A tenant admin, the only way the role is granted: the configured list. */
/** A platform administrator, for the definitions only they may write. */
async function platform(subject: string) {
  const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
  await ensurePlatformAdmin(actor, [`${subject}@gmail.com`]);
  return actor;
}

async function adminIn(tenant: string, subject: string) {
  const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
  const membership = await ensureConfiguredAdmin(actor, {
    slug: tenant,
    adminEmails: [`${subject}@gmail.com`],
  });
  expect(membership?.role).toBe('tenant_admin');
  return actor;
}

describe('configured admins', () => {
  it('makes a listed address a verified tenant admin, off the domain', async () => {
    const admin = await adminIn('aaa', 'adm-1');
    const membership = await membershipFor(admin.userId, 'aaa');
    expect(membership).toMatchObject({ role: 'tenant_admin', status: 'active' });
    expect(membership!.verificationMethod).toBe('config');
    expect(membership!.verifiedAt).toBeInstanceOf(Date);
  });

  it('upgrades an existing student rather than duplicating', async () => {
    const actor = await findOrCreateUser({ subject: 'adm-2', email: 'up@aaa.edu' });
    await ensureDomainMembership(actor, {
      slug: 'aaa',
      joinMode: 'domain',
      allowedEmailDomains: ['aaa.edu'],
    });
    await ensureConfiguredAdmin(actor, { slug: 'aaa', adminEmails: ['UP@AAA.EDU'] });
    const rows = await withActor(actor.userId, (tx) => tx.select().from(tenantMemberships));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('tenant_admin');
  });

  it('touches nobody who is not listed, and never downgrades', async () => {
    const admin = await adminIn('aaa', 'adm-3');
    expect(await ensureConfiguredAdmin(admin, { slug: 'aaa', adminEmails: [] })).toBeNull();
    expect((await membershipFor(admin.userId, 'aaa'))!.role).toBe('tenant_admin');
    const other = await findOrCreateUser({ subject: 'adm-4', email: 'plain@gmail.com' });
    expect(await ensureConfiguredAdmin(other, { slug: 'aaa', adminEmails: ['x@y.z'] })).toBeNull();
    expect(await membershipFor(other.userId, 'aaa')).toBeNull();
  });
});

describe('verification requests', () => {
  it('lets a person ask once, see their own, and change nothing', async () => {
    const user = await findOrCreateUser({ subject: 'req-1', email: 'req1@gmail.com' });
    const other = await findOrCreateUser({ subject: 'req-2', email: 'req2@gmail.com' });

    const asked = await requestVerification(user.userId, 'aaa', details);
    expect(asked.ok).toBe(true);
    expect((await latestRequest(user.userId, 'aaa'))?.status).toBe('pending');
    expect(await requestVerification(user.userId, 'aaa', details)).toEqual({
      ok: false,
      error: 'open_request',
    });

    // Nobody else can see it as themselves.
    expect(await withActor(other.userId, (tx) => tx.select().from(verificationRequests))).toEqual(
      [],
    );
    // And the person cannot answer it: the update matches nothing under RLS.
    await withActor(user.userId, (tx) =>
      tx.update(verificationRequests).set({ status: 'approved' }),
    );
    expect((await latestRequest(user.userId, 'aaa'))?.status).toBe('pending');
  });

  it('refuses someone already verified', async () => {
    const actor = await findOrCreateUser({ subject: 'req-3', email: 'v@aaa.edu' });
    await ensureDomainMembership(actor, {
      slug: 'aaa',
      joinMode: 'domain',
      allowedEmailDomains: ['aaa.edu'],
    });
    expect(await requestVerification(actor.userId, 'aaa', details)).toEqual({
      ok: false,
      error: 'already_verified',
    });
  });

  it('allows three asks in a month and refuses the fourth', async () => {
    const admin = await adminIn('aaa', 'adm-5');
    const user = await findOrCreateUser({ subject: 'req-4', email: 'rl@gmail.com' });
    for (let i = 0; i < 3; i += 1) {
      const asked = await requestVerification(user.userId, 'aaa', details);
      expect(asked.ok).toBe(true);
      if (asked.ok) {
        expect((await decideRequest(admin, 'aaa', asked.value.id, 'reject')).ok).toBe(true);
      }
    }
    expect(await requestVerification(user.userId, 'aaa', details)).toEqual({
      ok: false,
      error: 'rate_limited',
    });
  });

  it('shows an admin what is waiting, with handles and never an email', async () => {
    const admin = await adminIn('aaa', 'adm-6');
    const user = await findOrCreateUser({ subject: 'req-5', email: 'secret@gmail.com' });
    await requestVerification(user.userId, 'aaa', details);
    const pending = await listPendingRequests(admin, 'aaa');
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      const mine = pending.value.find((r) => r.userId === user.userId);
      expect(mine).toMatchObject({ handle: user.handle, fullName: 'Ayesha Khan' });
      expect(JSON.stringify(pending.value)).not.toContain('@');
    }
    expect(await listPendingRequests(user, 'aaa')).toEqual({ ok: false, error: 'not_admin' });
  });
});

describe('deciding requests', () => {
  async function ask(subject: string) {
    const user = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
    const asked = await requestVerification(user.userId, 'aaa', details);
    if (!asked.ok) throw new Error(asked.error);
    return { user, request: asked.value };
  }

  it('approving someone with no membership creates a verified one', async () => {
    const admin = await adminIn('aaa', 'adm-7');
    const { user, request } = await ask('dec-1');
    expect(await membershipFor(user.userId, 'aaa')).toBeNull();

    const decided = await decideRequest(admin, 'aaa', request.id, 'approve');
    expect(decided).toEqual({
      ok: true,
      value: { outcome: 'decided', decision: 'approve', membershipCreated: true },
    });
    const membership = await membershipFor(user.userId, 'aaa');
    expect(membership).toMatchObject({ role: 'student', status: 'active' });
    expect(membership!.verificationMethod).toBe('admin');
    expect(membership!.verifiedAt).toBeInstanceOf(Date);

    // The details have done their one job.
    const [row] = await withActor(user.userId, (tx) => tx.select().from(verificationRequests));
    expect(row).toMatchObject({ status: 'approved', fullName: null, rollNumber: null, note: null });
    expect(row!.decidedBy).toBe(admin.userId);
  });

  it('approving someone with an unverified membership verifies it in place', async () => {
    const admin = await adminIn('aaa', 'adm-8');
    const { user, request } = await ask('dec-2');
    await withActorInTenant(user.userId, 'aaa', (tx) =>
      tx
        .insert(tenantMemberships)
        .values({ tenantId: 'aaa', userId: user.userId, role: 'student' }),
    );

    const decided = await decideRequest(admin, 'aaa', request.id, 'approve');
    expect(decided).toMatchObject({ ok: true, value: { membershipCreated: false } });
    const rows = await withActor(user.userId, (tx) => tx.select().from(tenantMemberships));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verifiedAt).toBeInstanceOf(Date);
    expect(rows[0]!.verificationMethod).toBe('admin');
  });

  it('is idempotent: a second decision reports the first', async () => {
    const admin = await adminIn('aaa', 'adm-9');
    const { user, request } = await ask('dec-3');
    await decideRequest(admin, 'aaa', request.id, 'approve');
    expect(await decideRequest(admin, 'aaa', request.id, 'approve')).toEqual({
      ok: true,
      value: { outcome: 'already_decided', status: 'approved' },
    });
    // And a reject after an approve changes nothing either.
    expect(await decideRequest(admin, 'aaa', request.id, 'reject')).toEqual({
      ok: true,
      value: { outcome: 'already_decided', status: 'approved' },
    });
    expect(await withActor(user.userId, (tx) => tx.select().from(tenantMemberships))).toHaveLength(
      1,
    );
    const trail = await withActorInTenant(admin.userId, 'aaa', (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.targetId, request.id)),
    );
    expect(trail.filter((r) => r.action === 'verification.approved')).toHaveLength(1);
  });

  it('rejecting purges the details and creates nothing', async () => {
    const admin = await adminIn('aaa', 'adm-10');
    const { user, request } = await ask('dec-4');
    const decided = await decideRequest(admin, 'aaa', request.id, 'reject');
    expect(decided).toMatchObject({ ok: true, value: { decision: 'reject' } });
    expect(await membershipFor(user.userId, 'aaa')).toBeNull();
    expect((await latestRequest(user.userId, 'aaa'))?.status).toBe('rejected');
    const [row] = await withActor(user.userId, (tx) => tx.select().from(verificationRequests));
    expect(row!.fullName).toBeNull();
  });

  it('never lets anyone decide their own request', async () => {
    const admin = await adminIn('aaa', 'adm-11');
    const [own] = await withActor(admin.userId, (tx) =>
      tx
        .insert(verificationRequests)
        .values({ tenantId: 'aaa', userId: admin.userId, fullName: 'Me', rollNumber: '1' })
        .returning(),
    );
    expect(await decideRequest(admin, 'aaa', own!.id, 'approve')).toEqual({
      ok: false,
      error: 'self',
    });
    // And the database says the same, whatever the application does: nobody is
    // recorded as the decider of their own request.
    await expect(
      withActorInTenant(admin.userId, 'aaa', (tx) =>
        tx
          .update(verificationRequests)
          .set({ status: 'approved', decidedBy: admin.userId, decidedAt: new Date() })
          .where(eq(verificationRequests.id, own!.id)),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses a member without the role, and an admin of another tenant', async () => {
    const student = await findOrCreateUser({ subject: 'dec-5', email: 'st@aaa.edu' });
    await ensureDomainMembership(student, {
      slug: 'aaa',
      joinMode: 'domain',
      allowedEmailDomains: ['aaa.edu'],
    });
    const adminB = await adminIn('bbb', 'adm-12');
    const { request } = await ask('dec-6');

    expect(await decideRequest(student, 'aaa', request.id, 'approve')).toEqual({
      ok: false,
      error: 'not_admin',
    });
    expect(await decideRequest(adminB, 'aaa', request.id, 'approve')).toEqual({
      ok: false,
      error: 'not_admin',
    });
    // In their own tenant the row simply does not exist for them.
    expect(await decideRequest(adminB, 'bbb', request.id, 'approve')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect((await latestRequest(request.userId, 'aaa'))?.status).toBe('pending');
  });
});

describe('verifying by hand', () => {
  it('creates or verifies a membership for a handle, never for oneself', async () => {
    const admin = await adminIn('aaa', 'adm-13');
    const user = await findOrCreateUser({ subject: 'hand-1', email: 'hand@gmail.com' });

    expect(await userIdByHandle(user.handle.toLowerCase())).toBe(user.userId);
    expect(await userIdByHandle('Nobody_Here_0000')).toBeNull();

    expect(await verifyMember(admin, 'aaa', user.userId)).toEqual({
      ok: true,
      value: { created: true, alreadyVerified: false },
    });
    expect(await verifyMember(admin, 'aaa', user.userId)).toEqual({
      ok: true,
      value: { created: false, alreadyVerified: true },
    });
    expect(await verifyMember(admin, 'aaa', admin.userId)).toEqual({ ok: false, error: 'self' });

    // Verified another way while a request waits: the request is superseded
    // and purged in the same transaction, never left in the queue.
    const waiting = await findOrCreateUser({ subject: 'hand-2', email: 'wait@gmail.com' });
    const asked = await requestVerification(waiting.userId, 'aaa', details);
    expect(asked.ok).toBe(true);
    expect(await verifyMember(admin, 'aaa', waiting.userId)).toMatchObject({ ok: true });
    const [closed] = await withActor(waiting.userId, (tx) =>
      tx.select().from(verificationRequests),
    );
    expect(closed).toMatchObject({ status: 'superseded', fullName: null, rollNumber: null });
    const pending = await listPendingRequests(admin, 'aaa');
    expect(pending.ok && pending.value.some((r) => r.userId === waiting.userId)).toBe(false);
    expect(await verifyMember(admin, 'aaa', '00000000-0000-0000-0000-000000000000')).toEqual({
      ok: false,
      error: 'not_found',
    });

    const members = await listMembers(admin, 'aaa');
    expect(members.ok).toBe(true);
    if (members.ok) {
      expect(members.value.find((m) => m.userId === user.userId)).toMatchObject({
        handle: user.handle,
        roles: ['student'],
        verificationMethod: 'admin',
      });
      expect(JSON.stringify(members.value)).not.toContain('@');
    }
  });
});

describe('roles and permissions', () => {
  const domain = { slug: 'aaa', joinMode: 'domain' as const, allowedEmailDomains: ['aaa.edu'] };

  async function member(subject: string, tenant = 'aaa') {
    const actor = await findOrCreateUser({ subject, email: `${subject}@aaa.edu` });
    await ensureDomainMembership(actor, { ...domain, slug: tenant });
    return actor;
  }
  async function admin(subject: string, tenant = 'aaa') {
    const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
    await ensureConfiguredAdmin(actor, { slug: tenant, adminEmails: [`${subject}@gmail.com`] });
    return actor;
  }

  it('gives every tenant every system definition', async () => {
    const a = await admin('rbac-seed');
    const list = await listRoles(a.userId, 'aaa');
    // Six, not three: the community roles are definitions like any other since
    // the definitions moved to the platform, so a tenant materialises them all.
    // A role nobody holds grants nothing, so a tenant without the communities
    // module carries three inert rows.
    expect(list.map((r) => r.key).sort()).toEqual(
      expect.arrayContaining([
        'community_member',
        'community_moderator',
        'community_owner',
        'student',
        'teacher',
        'tenant_admin',
      ]),
    );
    expect(list.every((r) => r.isSystem)).toBe(true);
    expect(list.find((r) => r.key === 'tenant_admin')!.permissions).toContain('manage-roles');
    expect(list.find((r) => r.key === 'student')!.permissions.sort()).toEqual([
      'communities.create',
      'post',
    ]);
  });

  it('resolves an administrator to every permission and a student to one', async () => {
    const a = await admin('rbac-admin');
    const s = await member('rbac-student');
    expect(
      (await effectivePermissions(a.userId, 'aaa')).hasAll('manage-roles', 'view-analytics'),
    ).toBe(true);
    const studentPermissions = await effectivePermissions(s.userId, 'aaa');
    expect(studentPermissions.toArray().sort()).toEqual(['communities.create', 'post']);
    expect(studentPermissions.has('manage-roles')).toBe(false);
  });

  it('gives a stranger nothing at all', async () => {
    const nobody = await findOrCreateUser({ subject: 'rbac-none', email: 'none@gmail.com' });
    expect((await effectivePermissions(nobody.userId, 'aaa')).size).toBe(0);
  });

  it('never leaks a permission across tenants', async () => {
    // The whole point: power in one university is not power in another.
    const a = await admin('rbac-cross');
    expect(await can(a.userId, 'aaa', 'manage-roles')).toBe(true);
    expect(await can(a.userId, 'bbb', 'manage-roles')).toBe(false);
    expect((await effectivePermissions(a.userId, 'bbb')).size).toBe(0);
  });

  it('takes every permission from a suspended member without losing their roles', async () => {
    const a = await admin('rbac-susp-admin');
    const s = await member('rbac-susp');
    await withActorInTenant(a.userId, 'aaa', (tx) =>
      tx
        .update(tenantMemberships)
        .set({ status: 'suspended' })
        .where(eq(tenantMemberships.userId, s.userId)),
    );
    expect((await effectivePermissions(s.userId, 'aaa')).size).toBe(0);
    // The roles are still there, so lifting the suspension restores them.
    expect(await rolesForMember(a.userId, 'aaa', s.userId)).toEqual(['student']);
  });

  it('unions the permissions of every role a person holds', async () => {
    const a = await admin('rbac-union-admin');
    const s = await member('rbac-union');
    expect((await effectivePermissions(s.userId, 'aaa')).toArray().sort()).toEqual([
      'communities.create',
      'post',
    ]);

    expect(await grantRole(a, 'aaa', s.userId, 'tenant_admin')).toEqual({
      ok: true,
      changed: true,
    });
    const now = await effectivePermissions(s.userId, 'aaa');
    expect(now.has('post')).toBe(true);
    expect(now.has('moderate')).toBe(true);
    expect(await rolesForMember(a.userId, 'aaa', s.userId)).toEqual(['student', 'tenant_admin']);

    // Granting the same role again is a no op rather than an error.
    expect(await grantRole(a, 'aaa', s.userId, 'tenant_admin')).toEqual({
      ok: true,
      changed: false,
    });
  });

  it('refuses to grant or revoke without manage-roles', async () => {
    const a = await admin('rbac-guard-admin');
    const s = await member('rbac-guard-student');
    const other = await member('rbac-guard-other');
    expect(await grantRole(s, 'aaa', other.userId, 'tenant_admin')).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(await revokeRole(s, 'aaa', other.userId, 'student')).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(await rolesForMember(a.userId, 'aaa', other.userId)).toEqual(['student']);
  });

  it('refuses an unknown role and an unknown member', async () => {
    const a = await admin('rbac-unknown');
    const s = await member('rbac-unknown-member');
    expect(await grantRole(a, 'aaa', s.userId, 'root')).toEqual({
      ok: false,
      reason: 'no_such_role',
    });
    expect(await grantRole(a, 'aaa', '00000000-0000-0000-0000-000000000000', 'student')).toEqual({
      ok: false,
      reason: 'no_such_member',
    });
  });

  it('will not let a tenant remove its last administrator', async () => {
    const a = await admin('rbac-last');
    expect(await revokeRole(a, 'aaa', a.userId, 'tenant_admin')).toEqual({
      ok: false,
      reason: 'last_admin',
    });
    const second = await member('rbac-last-second');
    await grantRole(a, 'aaa', second.userId, 'tenant_admin');
    expect(await revokeRole(a, 'aaa', a.userId, 'tenant_admin')).toEqual({
      ok: true,
      changed: true,
    });
    expect(await can(a.userId, 'aaa', 'manage-roles')).toBe(false);
  });

  it('keeps the role tables unreadable without a tenant context', async () => {
    const s = await member('rbac-rls');
    // Resolving your own permissions goes through the definer function; the
    // tables themselves stay shut, so a permission check cannot become a way to
    // read every other member's roles.
    expect(await withActor(s.userId, (tx) => tx.select().from(roles))).toEqual([]);
    expect(await withActor(s.userId, (tx) => tx.select().from(rolePermissions))).toEqual([]);
    expect(await withActor(s.userId, (tx) => tx.select().from(membershipRoles))).toEqual([]);
  });

  it('never shows one tenant the roles of another', async () => {
    const a = await admin('rbac-tenant-a', 'aaa');
    await admin('rbac-tenant-b', 'bbb');
    const seen = await withActorInTenant(a.userId, 'aaa', (tx) =>
      tx.select().from(membershipRoles),
    );
    expect(seen.every((r) => r.tenantId === 'aaa')).toBe(true);
  });

  it('leaves an audit line for every role change', async () => {
    const a = await admin('rbac-audit');
    const s = await member('rbac-audit-member');
    await grantRole(a, 'aaa', s.userId, 'teacher');
    await revokeRole(a, 'aaa', s.userId, 'teacher');
    const trail = await withActorInTenant(a.userId, 'aaa', (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.actorUserId, a.userId)),
    );
    const actions = trail.map((r) => r.action);
    expect(actions).toContain('role.granted');
    expect(actions).toContain('role.revoked');
    expect(
      JSON.stringify(trail.map((r) => [r.action, r.targetType, r.targetId, r.meta])),
    ).not.toContain('@');
  });
});

describe('members, and the roles a tenant defines', () => {
  const domain = { slug: 'aaa', joinMode: 'domain' as const, allowedEmailDomains: ['aaa.edu'] };
  const details = { fullName: 'Ayesha Khan', rollNumber: 'FA21-BSCS-042' };

  async function member(subject: string, tenant = 'aaa') {
    const actor = await findOrCreateUser({ subject, email: `${subject}@aaa.edu` });
    await ensureDomainMembership(actor, { ...domain, slug: tenant });
    return actor;
  }
  async function admin(subject: string, tenant = 'aaa') {
    const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
    await ensureConfiguredAdmin(actor, { slug: tenant, adminEmails: [`${subject}@gmail.com`] });
    return actor;
  }

  it('lists members with the roles they hold, and only for manage-members', async () => {
    const a = await admin('mem-admin');
    const s = await member('mem-student');
    const list = await listMembers(a, 'aaa');
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.find((m) => m.userId === s.userId)?.roles).toEqual(['student']);
    expect(list.value.find((m) => m.userId === a.userId)?.roles).toEqual(['tenant_admin']);
    expect(JSON.stringify(list.value)).not.toContain('@');
    expect(await listMembers(s, 'aaa')).toEqual({ ok: false, error: 'not_allowed' });
  });

  it('restricts a member, which removes every permission until it is lifted', async () => {
    const a = await admin('sus-admin');
    const s = await member('sus-student');
    expect((await effectivePermissions(s.userId, 'aaa')).toArray().sort()).toEqual([
      'communities.create',
      'post',
    ]);
    const set = await setStanding(a, 'aaa', s.userId, {
      status: 'restricted',
      reason: 'Cooling off',
    });
    expect(set).toMatchObject({
      ok: true,
      value: { standing: { status: 'restricted', reason: 'Cooling off', until: null } },
    });
    expect((await effectivePermissions(s.userId, 'aaa')).size).toBe(0);
    // The person is told what was done, why, and that it has no end date.
    expect(await standingFor(s.userId, 'aaa')).toMatchObject({
      status: 'restricted',
      reason: 'Cooling off',
      until: null,
    });
    // And an administrator can see who is under one, with their reason.
    const listed = await listStandings(a, 'aaa');
    expect(listed.ok && listed.value.find((e) => e.userId === s.userId)).toMatchObject({
      status: 'restricted',
      reason: 'Cooling off',
    });
    expect(await listStandings(s, 'aaa')).toEqual({ ok: false, error: 'not_allowed' });

    // One appeal note, which the administrator sees and a new decision clears.
    expect(await appeal(s, 'aaa', 'It was a misunderstanding.')).toEqual({
      ok: true,
      value: { noted: true },
    });
    expect(await appeal(s, 'aaa', 'x')).toEqual({ ok: false, error: 'invalid' });
    const withAppeal = await listStandings(a, 'aaa');
    expect(withAppeal.ok && withAppeal.value.find((e) => e.userId === s.userId)?.appealNote).toBe(
      'It was a misunderstanding.',
    );
    // Appealing writes the note and nothing else: the person cannot lift their
    // own standing, nor verify themselves, by way of the one row they may write.
    expect(await standingFor(s.userId, 'aaa')).toMatchObject({ status: 'restricted' });
    expect(await membershipFor(s.userId, 'aaa')).toMatchObject({ status: 'restricted' });

    expect(await liftStanding(a, 'aaa', s.userId)).toEqual({ ok: true, value: { changed: true } });
    expect(await liftStanding(a, 'aaa', s.userId)).toEqual({ ok: true, value: { changed: false } });
    expect((await effectivePermissions(s.userId, 'aaa')).toArray().sort()).toEqual([
      'communities.create',
      'post',
    ]);
    expect(await standingFor(s.userId, 'aaa')).toMatchObject({ status: 'active', reason: null });
    // Nothing to appeal once it is lifted.
    expect(await appeal(s, 'aaa', 'Still sorry.')).toEqual({ ok: false, error: 'not_restricted' });
  });

  it('suspends a member, and lets a standing lapse on its own', async () => {
    const a = await admin('susp-admin');
    const s = await member('susp-student');
    const set = await setStanding(a, 'aaa', s.userId, {
      status: 'suspended',
      reason: 'Repeated abuse',
      minutes: 60,
    });
    expect(set).toMatchObject({ ok: true, value: { standing: { status: 'suspended' } } });
    expect(set.ok && set.value.standing.until).toBeInstanceOf(Date);
    expect((await effectivePermissions(s.userId, 'aaa')).size).toBe(0);
    expect(await standingFor(s.userId, 'aaa')).toMatchObject({
      status: 'suspended',
      reason: 'Repeated abuse',
    });

    // An expiry in the past is no longer a standing, and the permissions return
    // without anybody running anything: the resolver compares against now().
    await withActorInTenant(a.userId, 'aaa', (tx) =>
      tx.execute(
        sql`update tenant_memberships set standing_until = now() - interval '1 minute'
            where tenant_id = 'aaa' and user_id = ${s.userId}::uuid`,
      ),
    );
    expect(await standingFor(s.userId, 'aaa')).toMatchObject({ status: 'active' });
    expect((await effectivePermissions(s.userId, 'aaa')).toArray().sort()).toEqual([
      'communities.create',
      'post',
    ]);
    // A lapsed standing is not listed as current either.
    const listed = await listStandings(a, 'aaa');
    expect(listed.ok && listed.value.some((e) => e.userId === s.userId)).toBe(false);
  });

  it('refuses a standing on oneself, without the permission, or on the last administrator', async () => {
    const a = await admin('sus-self');
    const s = await member('sus-self-student');
    expect(
      await setStanding(a, 'aaa', a.userId, { status: 'restricted', reason: 'Myself' }),
    ).toEqual({ ok: false, error: 'self' });
    expect(
      await setStanding(s, 'aaa', a.userId, { status: 'restricted', reason: 'The boss' }),
    ).toEqual({ ok: false, error: 'not_allowed' });
    expect(await setStanding(a, 'aaa', s.userId, { status: 'restricted', reason: 'x' })).toEqual({
      ok: false,
      error: 'invalid',
    });

    // Someone who may restrict but is not an administrator still cannot remove
    // the last one: a tenant that locks itself out needs the platform to help.
    const p = await platform('sus-platform');
    const created = await createRoleTemplate(p, {
      name: 'Member Manager',
      permissions: ['manage-members', 'restrict-members'],
    });
    expect(created.ok).toBe(true);
    await grantRole(a, 'aaa', s.userId, 'member-manager');
    expect(
      await setStanding(s, 'aaa', a.userId, { status: 'restricted', reason: 'The boss' }),
    ).toEqual({ ok: false, error: 'last_admin' });
    expect(
      await setStanding(s, 'aaa', '00000000-0000-0000-0000-000000000000', {
        status: 'restricted',
        reason: 'Nobody',
      }),
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('lets the platform define a role, and every tenant receives it', async () => {
    const p = await platform('tpl-platform');
    const a = await admin('tpl-admin');
    const s = await member('tpl-student');

    const created = await createRoleTemplate(p, {
      name: 'Course Rep',
      permissions: ['post', 'moderate', 'moderate'],
    });
    expect(created).toMatchObject({
      ok: true,
      template: { key: 'course-rep', name: 'Course Rep', permissions: ['moderate', 'post'] },
    });
    expect(await createRoleTemplate(p, { name: 'course rep', permissions: [] })).toEqual({
      ok: false,
      reason: 'exists',
    });
    expect(await createRoleTemplate(p, { name: '!!!', permissions: [] })).toEqual({
      ok: false,
      reason: 'bad_name',
    });
    // The definition reached both tenants, not only the one anybody was looking at.
    for (const tenant of ['aaa', 'bbb']) {
      expect((await listRoles(p.userId, tenant)).map((r) => r.key)).toContain('course-rep');
    }

    await grantRole(a, 'aaa', s.userId, 'course-rep');
    expect((await effectivePermissions(s.userId, 'aaa')).hasAll('post', 'moderate')).toBe(true);
    // Changing the definition changes what the holder may do, everywhere at once.
    expect(await setRoleTemplatePermissions(p, 'course-rep', ['view-analytics'])).toEqual({
      ok: true,
      changed: true,
    });
    expect((await effectivePermissions(s.userId, 'aaa')).toArray().sort()).toEqual([
      'communities.create',
      'post',
      'view-analytics',
    ]);
    expect(await setRoleTemplatePermissions(p, 'course-rep', ['view-analytics'])).toEqual({
      ok: true,
      changed: false,
    });
    const listed = (await listRoles(a.userId, 'aaa')).find((r) => r.key === 'course-rep');
    expect(listed?.permissions).toEqual(['view-analytics']);
  });

  it('refuses a tenant administrator every definition, and every grant above their own head', async () => {
    const p = await platform('def-platform');
    const a = await admin('def-admin');
    const s = await member('def-student');

    // Definitions are not a tenant's to write, whatever permission they hold.
    expect(await createRoleTemplate(a, { name: 'Sneaky', permissions: ['manage-roles'] })).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(await setRoleTemplatePermissions(a, 'student', ['manage-roles'])).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(await deleteRoleTemplate(a, 'student')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await createRoleTemplate(s, { name: 'Sneakier', permissions: [] })).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    // And a system definition is refused even to the platform: every university
    // relies on tenant_admin, so retiring it would lock all of them out at once.
    expect(await deleteRoleTemplate(p, 'tenant_admin')).toEqual({
      ok: false,
      reason: 'system_template',
    });
    expect(await deleteRoleTemplate(p, 'nope')).toEqual({ ok: false, reason: 'no_such_template' });

    // Nobody may grant a power they do not have. `communities.unmask` is held by
    // nobody by default, so a tenant administrator cannot hand it out.
    const made = await createRoleTemplate(p, {
      name: 'Trust Office',
      permissions: ['communities.unmask'],
    });
    expect(made.ok).toBe(true);
    expect(await grantRole(a, 'aaa', s.userId, 'trust-office')).toEqual({
      ok: false,
      reason: 'above_own',
    });
    expect((await effectivePermissions(s.userId, 'aaa')).has('communities.unmask')).toBe(false);
    // The platform administrator who defined it may grant it, or it would be a
    // permission nobody could ever hold.
    expect(await grantRole(p, 'aaa', s.userId, 'trust-office')).toEqual({
      ok: true,
      changed: true,
    });
    expect((await effectivePermissions(s.userId, 'aaa')).has('communities.unmask')).toBe(true);
    // A role carrying only what the administrator already holds still grants.
    expect(await grantRole(a, 'aaa', s.userId, 'teacher')).toEqual({ ok: true, changed: true });
  });

  it("keeps one tenant's grants out of another, and the definitions shared", async () => {
    const p = await platform('iso-platform');
    const b = await admin('role-iso-b', 'bbb');
    await createRoleTemplate(p, { name: 'Only Once', permissions: ['post'] });
    // A definition is platform wide, so both tenants have it...
    expect((await listRoles(b.userId, 'bbb')).map((r) => r.key)).toContain('only-once');
    expect((await listRoleTemplates()).map((t) => t.key)).toContain('only-once');
    // ...but a grant in one tenant is not a grant in the other.
    const s = await member('role-iso-student', 'aaa');
    expect(await grantRole(b, 'bbb', s.userId, 'only-once')).toEqual({
      ok: false,
      reason: 'no_such_member',
    });
  });

  it("lets a role of the tenant's own approve verifications, and nothing more", async () => {
    const a = await admin('appr-admin');
    const approver = await member('appr-approver');
    const bystander = await member('appr-bystander');
    const asker = await findOrCreateUser({ subject: 'appr-asker', email: 'appr-asker@gmail.com' });
    const asked = await requestVerification(asker.userId, 'aaa', details);
    if (!asked.ok) throw new Error(asked.error);

    // A student holds `post` only: the queue is shut to them.
    expect(await listPendingRequests(bystander, 'aaa')).toEqual({ ok: false, error: 'not_admin' });
    expect(await decideRequest(bystander, 'aaa', asked.value.id, 'approve')).toEqual({
      ok: false,
      error: 'not_admin',
    });

    const p = await platform('appr-platform');
    await createRoleTemplate(p, { name: 'Registrar', permissions: ['approve-verifications'] });
    await grantRole(a, 'aaa', approver.userId, 'registrar');
    const pending = await listPendingRequests(approver, 'aaa');
    expect(pending.ok && pending.value.some((r) => r.id === asked.value.id)).toBe(true);
    expect(await decideRequest(approver, 'aaa', asked.value.id, 'approve')).toMatchObject({
      ok: true,
      value: { outcome: 'decided', decision: 'approve' },
    });
    // The permission opens the queue and nothing else.
    expect(await listMembers(approver, 'aaa')).toEqual({ ok: false, error: 'not_allowed' });
  });
});

describe('activity timing', () => {
  const domain = { slug: 'aaa', joinMode: 'domain' as const, allowedEmailDomains: ['aaa.edu'] };
  const karachi = { days: 14, timezone: 'Asia/Karachi' };

  async function member(subject: string, tenant = 'aaa') {
    const actor = await findOrCreateUser({ subject, email: `${subject}@aaa.edu` });
    await ensureDomainMembership(actor, { ...domain, slug: tenant });
    return actor;
  }
  async function admin(subject: string, tenant = 'aaa') {
    const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
    await ensureConfiguredAdmin(actor, { slug: tenant, adminEmails: [`${subject}@gmail.com`] });
    return actor;
  }
  async function marks(userId: string) {
    const [row] = await withActor(userId, (tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    return { login: row!.lastLoginAt, seen: row!.lastSeenAt };
  }

  it('stamps last login and last seen at sign in, and touches last seen at most hourly', async () => {
    const s = await member('act-student');
    expect(await marks(s.userId)).toEqual({ login: null, seen: null });
    const issued = await issueSession(s);
    const signedIn = await marks(s.userId);
    expect(signedIn.login).toBeInstanceOf(Date);
    expect(signedIn.seen).toBeInstanceOf(Date);

    // Two hours later (by fiat): resolving the session brings last seen forward.
    await runAsMigrationRole(
      `update users set last_seen_at = now() - interval '2 hours' where id = '${s.userId}'`,
    );
    await runAsMigrationRole(
      `update sessions set last_used_at = now() - interval '2 hours' where user_id = '${s.userId}'`,
    );
    await resolveSession(issued.token);
    const touched = await marks(s.userId);
    expect(touched.seen!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(touched.login!.getTime()).toBe(signedIn.login!.getTime());

    // Within the hour, a second resolve writes nothing.
    await resolveSession(issued.token);
    expect((await marks(s.userId)).seen!.getTime()).toBe(touched.seen!.getTime());
  });

  it('aggregates activity for the tenant, for view-analytics only', async () => {
    const a = await admin('act-admin');
    const s = await member('act-member');
    await issueSession(s);
    const result = await tenantActivity(a, 'aaa', karachi);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals).toEqual({
      members: 2,
      activeDay: 1,
      activeWeek: 1,
      activeMonth: 1,
    });
    expect(result.value.days).toHaveLength(14);
    expect(result.value.days[13]).toMatchObject({ signIns: 1, lastActive: 1 });
    expect(result.value.days.slice(0, 13).every((d) => d.signIns === 0)).toBe(true);
    expect(result.value.byRole.find((r) => r.key === 'student')?.members).toBe(1);
    expect(result.value.byRole.find((r) => r.key === 'tenant_admin')?.members).toBe(1);
    expect(result.value.queue).toEqual({ pending: 0, oldestPendingAt: null });
    // Counts only: no handle, no email, no timestamp of anyone in particular.
    expect(JSON.stringify(result.value)).not.toContain('@');
    expect(JSON.stringify(result.value)).not.toContain(s.handle);
    expect(await tenantActivity(s, 'aaa', karachi)).toEqual({ ok: false, error: 'not_allowed' });
  });

  it("keeps one tenant's activity out of another", async () => {
    const a = await admin('act-a', 'aaa');
    const b = await admin('act-b', 'bbb');
    await issueSession(a);
    const other = await tenantActivity(b, 'bbb', { days: 7, timezone: 'UTC' });
    expect(other.ok && other.value.totals).toEqual({
      members: 1,
      activeDay: 0,
      activeWeek: 0,
      activeMonth: 0,
    });
    expect(other.ok && other.value.days.every((d) => d.signIns === 0)).toBe(true);
    expect(await tenantActivity(a, 'bbb', { days: 7, timezone: 'UTC' })).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });

  it('gives the member list a coarse bucket per person and nothing finer', async () => {
    const a = await admin('act-list');
    const s = await member('act-list-member');
    await issueSession(s);
    const list = await listMembers(a, 'aaa');
    expect(list.ok && list.value.find((m) => m.userId === s.userId)?.activity).toBe('day');
    expect(list.ok && list.value.find((m) => m.userId === a.userId)?.activity).toBe('never');
    expect(JSON.stringify(list.ok ? list.value : [])).not.toMatch(/seen/i);
  });

  it('has no column for an address anywhere', async () => {
    const rows = [
      ...(await getDb().execute(sql`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'ip_hash'`)),
    ];
    expect(rows).toEqual([]);
  });
});

describe('platform administration', () => {
  async function platformAdmin(subject: string) {
    const actor = await findOrCreateUser({ subject, email: `${subject}@example.com` });
    await ensurePlatformAdmin(actor, [`${subject}@example.com`]);
    return actor;
  }
  const config = (slug: string) => ({
    slug,
    displayName: `${slug.toUpperCase()} University`,
    timezone: 'Asia/Karachi',
    locale: 'en',
    branding: { colors: { primary: '#123456' }, logoPath: '/x.svg' },
    seo: { titleTemplate: '%s · X', description: 'X.' },
    allowedEmailDomains: [`${slug}.edu`],
  });

  it('makes a listed address a platform admin once, and never an unlisted one', async () => {
    const a = await findOrCreateUser({ subject: 'pa-1', email: 'pa-1@example.com' });
    expect(await ensurePlatformAdmin(a, ['other@example.com'])).toBe(false);
    expect(await isPlatformAdmin(a.userId)).toBe(false);
    expect(await ensurePlatformAdmin(a, ['PA-1@example.com'])).toBe(true);
    // Already granted: nothing to do, and no second audit line.
    expect(await ensurePlatformAdmin(a, ['pa-1@example.com'])).toBe(false);
    expect(await isPlatformAdmin(a.userId)).toBe(true);
    const trail = await withActor(a.userId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.actorUserId, a.userId)),
    );
    expect(trail.filter((r) => r.action === 'platform.admin_granted')).toHaveLength(1);
  });

  it('has row security on universities, without FORCE so the definers can read it', async () => {
    const [row] = [
      ...(await getDb().execute(
        sql`select relrowsecurity, relforcerowsecurity from pg_class
            where relname = 'universities' and relkind = 'r'`,
      )),
    ] as { relrowsecurity: boolean; relforcerowsecurity: boolean }[];
    expect(row?.relrowsecurity).toBe(true);
    // FORCE off: the karma rebuild and the role-template sync read every tenant
    // as the owner, and FORCE would filter the owner out.
    expect(row?.relforcerowsecurity).toBe(false);
  });

  it('creates a tenant with its system roles and one audit line, in one transaction', async () => {
    const root = await platformAdmin('root-create');
    const created = await createTenant(root, config('ccc'));
    expect(created).toMatchObject({ ok: true, version: 1 });
    // Readable with no context at all: this is what renders public pages.
    const rows = await listTenantConfigs();
    expect(rows.find((r) => r.slug === 'ccc')?.config).toMatchObject({
      displayName: 'CCC University',
    });
    const [u] = await getDb().select().from(universities).where(eq(universities.slug, 'ccc'));
    expect(u).toMatchObject({ name: 'CCC University', timezone: 'Asia/Karachi' });
    // Every definition, including any another test added: a new tenant
    // materialises the catalogue as it stands.
    const seeded = await listRoles(root.userId, 'ccc');
    expect(seeded.map((r) => r.key).sort()).toEqual(
      expect.arrayContaining([
        'community_member',
        'community_moderator',
        'community_owner',
        'student',
        'teacher',
        'tenant_admin',
      ]),
    );
    const trail = await withActorInTenant(root.userId, 'ccc', (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.tenantId, 'ccc')),
    );
    expect(trail.map((r) => r.action)).toEqual(['tenant.created']);

    expect(await createTenant(root, config('ccc'))).toEqual({ ok: false, reason: 'exists' });
    expect(await createTenant(root, { ...config('ddd'), branding: {} })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('refuses everyone who is not a platform admin, at the application and at the row', async () => {
    const s = await findOrCreateUser({ subject: 'pa-student', email: 'pa-student@aaa.edu' });
    expect(await createTenant(s, config('eee'))).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await updateTenantConfig(s, 'aaa', config('aaa'))).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    // Even a direct write under their own context matches no policy.
    await expect(
      withActorInTenant(s.userId, 'aaa', (tx) =>
        tx.insert(tenantConfigs).values({ slug: 'aaa', config: config('aaa') }),
      ),
    ).rejects.toThrow();
    expect((await listTenantConfigs()).find((r) => r.slug === 'aaa')).toBeUndefined();

    // The same holds for universities (0017), the table whose deletes cascade to
    // every tenant-scoped row: a non-platform-admin cannot insert, rename, or
    // delete one, at the row, whatever context they set.
    await expect(
      withActorInTenant(s.userId, 'fff', (tx) =>
        tx.insert(universities).values({ slug: 'fff', name: 'Rogue U', timezone: 'UTC' }),
      ),
    ).rejects.toThrow();
    await expect(
      withActorInTenant(s.userId, 'aaa', (tx) =>
        tx
          .update(universities)
          .set({ name: 'Renamed by nobody' })
          .where(eq(universities.slug, 'aaa'))
          .returning(),
      ),
    ).resolves.toHaveLength(0); // UPDATE matches no row under the policy: no error, no change
    await expect(
      withActorInTenant(s.userId, 'aaa', (tx) =>
        tx.delete(universities).where(eq(universities.slug, 'aaa')).returning(),
      ),
    ).resolves.toHaveLength(0); // DELETE has no policy at all: nothing deleted
    const [stillThere] = await getDb()
      .select()
      .from(universities)
      .where(eq(universities.slug, 'aaa'));
    expect(stillThere?.name).toBe('Alpha U');
    expect(
      await getDb().select().from(universities).where(eq(universities.slug, 'fff')),
    ).toHaveLength(0);
  });

  it('updates a tenant at the next version and keeps the slug immutable', async () => {
    const root = await platformAdmin('root-update');
    // aaa exists as a universities row with no config yet, as LGU does today.
    expect(await updateTenantConfig(root, 'aaa', config('aaa'))).toMatchObject({
      ok: true,
      version: 1,
    });
    expect(
      await updateTenantConfig(root, 'aaa', { ...config('aaa'), displayName: 'Alpha Renamed' }),
    ).toMatchObject({ ok: true, version: 2 });
    const [u] = await getDb().select().from(universities).where(eq(universities.slug, 'aaa'));
    expect(u?.name).toBe('Alpha Renamed');
    expect(await updateTenantConfig(root, 'aaa', config('zzz'))).toEqual({
      ok: false,
      reason: 'slug_mismatch',
    });
    expect(await updateTenantConfig(root, 'nope', config('nope'))).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('tenant grants (cross-tenant platform administration)', () => {
  // The tenants are re-created empty each test (beforeEach truncates and
  // re-inserts aaa/bbb), so their system roles must be synced for the resolver's
  // grant branch to have a tenant_admin role to resolve to. A resident member is
  // what normally triggers this; a grant test creates none, so sync explicitly.
  beforeEach(async () => {
    await runAsMigrationRole(
      `select auth_sync_tenant_roles('aaa')`,
      `select auth_sync_tenant_roles('bbb')`,
    );
  });

  async function platformActor(subject: string) {
    const actor = await findOrCreateUser({ subject, email: `${subject}@example.com` });
    await ensurePlatformAdmin(actor, [`${subject}@example.com`]);
    const issued = await issueSession(actor);
    const [row] = await withActor(actor.userId, (tx) =>
      tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, actor.userId)),
    );
    return { userId: actor.userId, sessionId: row!.id, token: issued.token };
  }

  /** The resolver, evaluated INSIDE a granted transaction (as 5B surfaces will). */
  function permsUnderGrant(a: { userId: string; sessionId: string }, tenant: string) {
    return withGrantedTenant(a, async (tx) => {
      const rows = [
        ...(await tx.execute(
          sql`select permission from auth_effective_permissions(${a.userId}::uuid, ${tenant})`,
        )),
      ] as { permission: string }[];
      return rows.map((r) => r.permission);
    });
  }

  it('opens a grant, resolves as the tenant admin minus unmask, and logs it once', async () => {
    const p = await platformActor('grant-a');
    const grant = await withPlatformGrant(
      p,
      'aaa',
      'helping during an outage',
      async (_tx, g) => g,
    );
    expect(grant.tenantId).toBe('aaa');
    expect(grant.reason).toBe('helping during an outage');

    const perms = await permsUnderGrant(p, 'aaa');
    // The tenant's own tenant_admin set, which includes managing members/roles...
    expect(perms).toEqual(
      expect.arrayContaining(['manage-members', 'manage-roles', 'restrict-members']),
    );
    // ...but never the sharpest power: a visitor is narrower than the resident.
    expect(perms).not.toContain('communities.unmask');

    // The opening was audited, exactly once, against the tenant.
    const log = await withActor(p.userId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, 'platform.tenant_grant_opened')),
    );
    expect(log.filter((r) => r.tenantId === 'aaa' && r.actorUserId === p.userId)).toHaveLength(1);
  });

  it('resolves to nothing on the bare pool, so every surface stays 404 until 5B', async () => {
    const p = await platformActor('grant-bare');
    await withPlatformGrant(p, 'aaa', 'a good enough reason', async () => undefined);
    // No transaction, no use row: the grant branch cannot see itself.
    expect((await effectivePermissions(p.userId, 'aaa')).size).toBe(0);
  });

  it('refuses self-promotion under a grant, even when app.user_id is forged mid-transaction', async () => {
    const p = await platformActor('grant-self');
    await withPlatformGrant(p, 'aaa', 'entered to look at reports', async () => undefined);

    // The attack the review found: open the grant, then re-set app.user_id to a
    // decoy so a check against the GUC would pass, then self-insert. The policy
    // keys on the unforgeable grant admin, so it stays refused.
    await expect(
      withGrantedTenant(p, async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', gen_random_uuid()::text, true)`);
        await tx.execute(
          sql`insert into tenant_memberships (tenant_id, user_id, role, status)
              values ('aaa', ${p.userId}::uuid, 'tenant_admin', 'active')`,
        );
      }),
    ).rejects.toThrow();

    // And the role-assignment half of the same escalation.
    await expect(
      withGrantedTenant(p, async (tx) => {
        const [r] = [
          ...(await tx.execute(
            sql`select id from roles where tenant_id = 'aaa' and key = 'tenant_admin'`,
          )),
        ] as { id: string }[];
        const [m] = [
          ...(await tx.execute(
            sql`insert into tenant_memberships (tenant_id, user_id, role, status)
                values ('aaa', ${p.userId}::uuid, 'student', 'active')
                on conflict do nothing returning id`,
          )),
        ] as { id: string }[];
        await tx.execute(
          sql`insert into membership_roles (membership_id, role_id, tenant_id, user_id)
              values (${m?.id ?? null}, ${r!.id}::uuid, 'aaa', ${p.userId}::uuid)`,
        );
      }),
    ).rejects.toThrow();

    // Nothing stuck: they hold no membership in aaa.
    expect(await membershipFor(p.userId, 'aaa')).toBeNull();
  });

  it('withdraws the platform-level powers a resident admin does not have', async () => {
    const p = await platformActor('grant-sub');
    await withPlatformGrant(p, 'aaa', 'entered to moderate a thread', async () => undefined);

    // Role definitions, tenant config and universities: INSERT raises under a grant.
    for (const stmt of [
      sql`insert into roles (tenant_id, key, name, is_system) values ('aaa', 'rogue', 'Rogue', false)`,
      sql`insert into tenant_configs (slug, config) values ('aaa', '{}'::jsonb)`,
      sql`insert into universities (slug, name, timezone) values ('rogue-u', 'Rogue', 'UTC')`,
    ]) {
      await expect(withGrantedTenant(p, (tx) => tx.execute(stmt))).rejects.toThrow();
    }

    // UPDATE is the silent case the review flagged: a RESTRICTIVE USING filters
    // rather than raising, so assert the ROW COUNT is zero, not that it throws.
    const updated = await withGrantedTenant(p, async (tx) => {
      const rows = [
        ...(await tx.execute(
          sql`update universities set name = 'hijacked' where slug = 'aaa' returning slug`,
        )),
      ];
      return rows.length;
    });
    expect(updated).toBe(0);
    const [u] = await getDb().select().from(universities).where(eq(universities.slug, 'aaa'));
    expect(u?.name).toBe('Alpha U');
  });

  it('allows only one open grant per administrator at a time', async () => {
    const p = await platformActor('grant-one');
    await withPlatformGrant(p, 'aaa', 'first entry reason here', async () => undefined);
    await expect(
      withPlatformGrant(p, 'bbb', 'second entry reason here', async () => undefined),
    ).rejects.toThrow();
  });

  it('is ended by the holder or revoked by another platform admin, and not by a stranger', async () => {
    const p = await platformActor('grant-rev');
    const other = await platformActor('grant-rev2');
    const stranger = await findOrCreateUser({ subject: 'grant-rev-str', email: 'str@aaa.edu' });
    const grant = await withPlatformGrant(p, 'aaa', 'a reason to be here', async (_tx, g) => g);

    // A stranger cannot revoke it.
    await expect(
      withActor(stranger.userId, (tx) =>
        tx.execute(sql`select auth_revoke_tenant_grant(${grant.grantId}::uuid, 'nope')`),
      ),
    ).rejects.toThrow();

    // Another platform admin can, and a second revoke is a no-op (false).
    const revoked = await withActor(other.userId, async (tx) => {
      const [r] = [
        ...(await tx.execute(
          sql`select auth_revoke_tenant_grant(${grant.grantId}::uuid, 'covering') as ok`,
        )),
      ] as { ok: boolean }[];
      return r!.ok;
    });
    expect(revoked).toBe(true);
    const again = await withActor(other.userId, async (tx) => {
      const [r] = [
        ...(await tx.execute(
          sql`select auth_revoke_tenant_grant(${grant.grantId}::uuid, 'x') as ok`,
        )),
      ] as { ok: boolean }[];
      return r!.ok;
    });
    expect(again).toBe(false);

    // Once revoked, the grant cannot be re-entered.
    await expect(withGrantedTenant(p, async () => undefined)).rejects.toThrow();
  });

  it('lets the application neither write the grants nor read the uses (split database only)', async () => {
    const p = await platformActor('grant-lock');
    const grant = await withPlatformGrant(p, 'aaa', 'a legitimate reason', async (_tx, g) => g);
    // This suite refuses to run on an unsplit database (see the guard in
    // beforeAll), so the application role is always a non-owner here.
    // Writing the grant table directly is revoked from the app role.
    await expect(
      withActorInTenant(p.userId, 'aaa', (tx) =>
        tx.execute(
          sql`insert into platform_tenant_grants
              (admin_user_id, session_id, tenant_id, reason, expires_at, audit_id)
              values (${p.userId}::uuid, ${p.sessionId}::uuid, 'aaa', 'forged forged forged',
                      now() + interval '1 hour', 1)`,
        ),
      ),
    ).rejects.toThrow();
    // The uses table has no grant to the app at all, so even reading it is denied.
    await expect(
      withActorInTenant(p.userId, 'aaa', (tx) =>
        tx.execute(sql`select count(*) from platform_grant_uses`),
      ),
    ).rejects.toThrow();
    expect(grant.grantId).toBeTruthy();
  });
});
