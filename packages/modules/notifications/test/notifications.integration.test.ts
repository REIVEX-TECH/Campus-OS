import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withActorInTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import { manifest as communitiesManifest } from '@campusos/module-communities/manifest';
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable } from '../src/manifest';
import { notify } from '../src/notify';
import { listGenericInbox, markRead, recordClick, unreadCount } from '../src/inbox';

/**
 * The notifications seam: a module emits a generic notification through the definer
 * (the app cannot INSERT the table), the recipient reads only their own, a
 * self-notification is dropped, and the unread count is kind-agnostic. Communities
 * created the table; this module's migration ALTERs it, so the suite applies
 * communities' migrations first. Refuses to run on an unsplit database.
 */

let split = false;

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(
    migrationDatabaseUrl(),
    identityManifest.migrations.folder,
    identityManifest.migrations.table,
  );
  await applyMigrations(
    migrationDatabaseUrl(),
    communitiesManifest.migrations.folder,
    communitiesManifest.migrations.table,
  );
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder, migrationsTable);
  const [ownership] = [
    ...(await getDb().execute(sql`
      select pg_get_userbyid(relowner) = current_user as app_owns
      from pg_class where relname = 'notifications' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "notifications" restart identity cascade',
    'truncate table "users" restart identity cascade',
    'truncate table "universities" restart identity cascade',
  );
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values ('aaa','Alpha U','Asia/Karachi')
     on conflict ("slug") do nothing`,
  );
});

async function member(subject: string, tenant = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@${tenant}.edu` });
  await ensureDomainMembership(actor, {
    slug: tenant,
    joinMode: 'domain' as const,
    allowedEmailDomains: [`${tenant}.edu`],
  });
  return actor;
}

describe('notifications seam', () => {
  it('emits a generic notification the recipient can read, and hides it from others', async () => {
    if (!split) return;
    const recipient = await member('ntf-r');
    const other = await member('ntf-o');
    await notify('aaa', {
      userId: recipient.userId,
      kind: 'services.order_delivered',
      payload: { title: 'Poster design' },
      link: '/u/aaa/orders/abc',
    });
    const inbox = await listGenericInbox(recipient, 'aaa');
    expect(inbox.map((i) => i.kind)).toEqual(['services.order_delivered']);
    expect(inbox[0]?.link).toBe('/u/aaa/orders/abc');
    expect(inbox[0]?.payload).toMatchObject({ title: 'Poster design' });
    // Another member sees none of it (own-row RLS).
    expect(await listGenericInbox(other, 'aaa')).toHaveLength(0);
    expect(await unreadCount(other, 'aaa')).toBe(0);
  });

  it('drops a self-notification (actor is the recipient)', async () => {
    if (!split) return;
    const u = await member('ntf-self');
    await notify('aaa', {
      userId: u.userId,
      kind: 'marketplace.sold',
      link: '/u/aaa/marketplace/x',
      actorId: u.userId,
    });
    expect(await unreadCount(u, 'aaa')).toBe(0);
  });

  it('refuses a raw application insert for another user (only the definer notifies across)', async () => {
    if (!split) return;
    const u = await member('ntf-raw');
    const victim = await member('ntf-raw-victim');
    // The own-row WITH CHECK lets a caller only ever write user_id = themselves, so a
    // forged notification aimed at someone else is refused; the definer, running as
    // the owner, is the only path that can notify a different recipient.
    await expect(
      withActorInTenant(u.userId, 'aaa', (tx) =>
        tx.execute(sql`insert into notifications (tenant_id, user_id, kind, link)
                       values ('aaa', ${victim.userId}::uuid, 'forged', '/x')`),
      ),
    ).rejects.toThrow();
  });

  it('counts all unread kind-agnostically and marks read', async () => {
    if (!split) return;
    const u = await member('ntf-count');
    const actor = await member('ntf-count-actor');
    for (const link of ['/a', '/b', '/c']) {
      await notify('aaa', {
        userId: u.userId,
        kind: 'lostfound.claim_opened',
        link,
        actorId: actor.userId,
      });
    }
    expect(await unreadCount(u, 'aaa')).toBe(3);
    const inbox = await listGenericInbox(u, 'aaa');
    expect(inbox).toHaveLength(3);
    expect(inbox[0]?.actorHandle).not.toBeNull();
    // Mark one, then all.
    expect((await markRead(u, 'aaa', [inbox[0]!.id])).marked).toBe(1);
    expect(await unreadCount(u, 'aaa')).toBe(2);
    expect((await markRead(u, 'aaa', 'all')).marked).toBe(2);
    expect(await unreadCount(u, 'aaa')).toBe(0);
  });

  it('records a click-through once, marks it read, and only on own rows', async () => {
    if (!split) return;
    const u = await member('ntf-click');
    const other = await member('ntf-click-other');
    const actor = await member('ntf-click-actor');
    await notify('aaa', {
      userId: u.userId,
      kind: 'services.order_delivered',
      link: '/u/aaa/orders/z',
      actorId: actor.userId,
    });
    const [item] = await listGenericInbox(u, 'aaa');
    expect(item).toBeDefined();
    // Another member cannot stamp it (own-row RLS): no row matches, nothing recorded.
    expect((await recordClick(other, 'aaa', item!.id)).recorded).toBe(false);
    // The recipient's first click records and marks it read (following > reading).
    expect((await recordClick(u, 'aaa', item!.id)).recorded).toBe(true);
    expect(await unreadCount(u, 'aaa')).toBe(0);
    // Idempotent: a second click is a no-op, so the metric counts clickers, not clicks.
    expect((await recordClick(u, 'aaa', item!.id)).recorded).toBe(false);
    const rows = [
      ...(await withActorInTenant(u.userId, 'aaa', (tx) =>
        tx.execute(sql`select clicked_at from notifications where id = ${item!.id}::uuid`),
      )),
    ] as { clicked_at: string | Date | null }[];
    expect(rows[0]?.clicked_at).not.toBeNull();
  });
});
