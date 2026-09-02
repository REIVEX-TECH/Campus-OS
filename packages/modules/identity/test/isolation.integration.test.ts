import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withActor, withActorInTenant, withTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import { applyMigrations, runBaseMigrations } from '@campusos/db/migrate';
import { universities } from '@campusos/db/schema';
import { migrationsFolder, migrationsTable } from '../src/manifest';
import {
  auditLog,
  platformRoles,
  sessions,
  tenantMemberships,
  users,
} from '../src/schema/identity';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

beforeAll(async () => {
  await runBaseMigrations(DATABASE_URL);
  await applyMigrations(DATABASE_URL, migrationsFolder, migrationsTable);
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
  await getDb().execute(sql`truncate table "users" restart identity cascade`);
  await getDb().execute(sql`truncate table "audit_log" restart identity cascade`);
  await getDb().execute(sql`truncate table "universities" restart identity cascade`);
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
