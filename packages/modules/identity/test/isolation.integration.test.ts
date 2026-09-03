import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withActor, withActorInTenant, withTenant } from '@campusos/db';
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
  platformRoles,
  sessions,
  tenantMemberships,
  userRecents,
  users,
  verificationRequests,
} from '../src/schema/identity';
import { findOrCreateUser, issueSession, resolveSession, revokeSession } from '../src/sessions';
import { changeHandle, rerollAvatar } from '../src/handles/service';
import { HANDLE_PATTERN } from '../src/handles/handle';
import { ensureConfiguredAdmin, ensureDomainMembership, membershipFor } from '../src/membership';
import {
  decideRequest,
  latestRequest,
  listMembers,
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
  await getDb()
    .insert(universities)
    .values([
      { slug: 'aaa', name: 'Alpha U', timezone: 'Asia/Karachi' },
      { slug: 'bbb', name: 'Beta U', timezone: 'Asia/Karachi' },
    ])
    .onConflictDoNothing();
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
    const seed = await rerollAvatar(actor.userId);
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
  it('are visible only to the user who holds them', async () => {
    await withActor(alice, (tx) =>
      tx.insert(platformRoles).values({ userId: alice, role: 'platform_admin' }),
    );
    expect(await withActor(alice, (tx) => tx.select().from(platformRoles))).toHaveLength(1);
    expect(await withActor(bob, (tx) => tx.select().from(platformRoles))).toHaveLength(0);
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
    tenant_memberships: true,
    platform_roles: true,
    audit_log: true,
    user_recents: true,
    verification_requests: true,
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

  it('does nothing for anyone else', async () => {
    const actor = await findOrCreateUser({ subject: 'dom-2', email: 'someone@gmail.com' });
    expect(await ensureDomainMembership(actor, policy)).toBeNull();
    expect(await membershipFor(actor.userId, 'aaa')).toBeNull();
  });

  it('does nothing for a tenant that joins by invitation', async () => {
    const actor = await findOrCreateUser({ subject: 'dom-3', email: 'student@aaa.edu' });
    expect(await ensureDomainMembership(actor, { ...policy, joinMode: 'invite' })).toBeNull();
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
        role: 'student',
        verificationMethod: 'admin',
      });
      expect(JSON.stringify(members.value)).not.toContain('@');
    }
  });
});
