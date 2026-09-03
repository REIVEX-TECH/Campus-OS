import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
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
  users,
} from '../src/schema/identity';
import { findOrCreateUser, issueSession, resolveSession, revokeSession } from '../src/sessions';

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
    await withActor(alice, (tx) =>
      tx.insert(tenantMemberships).values([
        { tenantId: 'aaa', userId: alice, role: 'student' },
        { tenantId: 'bbb', userId: alice, role: 'teacher' },
      ]),
    );
    await withActor(bob, (tx) =>
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
});

describe('sign in lifecycle', () => {
  const identity = { subject: 'google-sub-1', email: 'new@aaa.edu' };

  it('creates a user on first sign in and finds the same one after', async () => {
    const first = await findOrCreateUser(identity);
    expect(first.email).toBe(identity.email);
    // The handle is a placeholder until handles are properly generated, but it
    // must already be unique and obviously not a chosen name.
    expect(first.handle).toMatch(/^Member_/);

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
