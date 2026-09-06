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
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { migrationsFolder, migrationsTable, settingsSchema } from '../src/manifest';
import {
  deleteForEveryone,
  editMessage,
  listInbox,
  markRead,
  sendMessage,
  startConversation,
  thread,
  unreadCount,
} from '../src/service';

/**
 * Direct messages against a real Postgres: a conversation and its messages are
 * visible ONLY to the two participants, and the tenant's who-can-message policy
 * and the edit/delete windows hold. The RLS assertions need a split database (the
 * app role must not own the tables); they are skipped elsewhere and run in CI.
 */

const settings = settingsSchema.parse({});
let split = false;

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(
    migrationDatabaseUrl(),
    identityManifest.migrations.folder,
    identityManifest.migrations.table,
  );
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder, migrationsTable);
  const [ownership] = [
    ...(await getDb().execute(sql`
      select pg_get_userbyid(relowner) = current_user as app_owns
      from pg_class where relname = 'msg_messages' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "msg_messages" restart identity cascade',
    'truncate table "msg_participant_state" restart identity cascade',
    'truncate table "msg_conversations" restart identity cascade',
    'truncate table "users" restart identity cascade',
    'truncate table "universities" restart identity cascade',
  );
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values
       ('aaa','Alpha U','Asia/Karachi'), ('bbb','Beta U','Asia/Karachi')
     on conflict ("slug") do nothing`,
  );
});

const domain = (slug: string) => ({
  slug,
  joinMode: 'domain' as const,
  allowedEmailDomains: [`${slug}.edu`],
});

/** A verified member (email on the tenant's domain). */
async function member(subject: string, tenant = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@${tenant}.edu` });
  await ensureDomainMembership(actor, domain(tenant));
  return actor;
}

/** A member joined but not verified (off-domain email). */
async function unverified(subject: string, tenant = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
  await ensureDomainMembership(actor, domain(tenant));
  return actor;
}

async function open(a: { userId: string }, b: { userId: string }, tenant = 'aaa') {
  const res = await startConversation(a, tenant, b.userId, settings);
  if (!res.ok) throw new Error(`start failed: ${res.error}`);
  return res.value.id;
}

describe('direct messages RLS', () => {
  it('confines a conversation and its messages to the two participants', async () => {
    if (!split) return;
    const a = await member('dm-a');
    const b = await member('dm-b');
    const outsider = await member('dm-out');
    const id = await open(a, b);
    expect((await sendMessage(a, 'aaa', id, { body: 'hello b' }, settings)).ok).toBe(true);
    expect((await sendMessage(b, 'aaa', id, { body: 'hi a' }, settings)).ok).toBe(true);

    // Both participants read the whole thread...
    expect((await thread(a, 'aaa', id))?.messages.map((m) => m.body)).toEqual(['hello b', 'hi a']);
    expect((await thread(b, 'aaa', id))?.messages.map((m) => m.body)).toEqual(['hello b', 'hi a']);
    // ...an outsider sees neither the conversation nor a single message row.
    expect(await thread(outsider, 'aaa', id)).toBeNull();
    const leaked = await withActorInTenant(outsider.userId, 'aaa', (tx) =>
      tx.execute(sql`select id from msg_messages where conversation_id = ${id}::uuid`),
    );
    expect([...leaked]).toHaveLength(0);
  });

  it('refuses a non-participant sending into the conversation', async () => {
    if (!split) return;
    const a = await member('dm-np-a');
    const b = await member('dm-np-b');
    const outsider = await member('dm-np-out');
    const id = await open(a, b);
    // The outsider cannot see the conversation, so the send is a clean not_found,
    // and a raw insert as the outsider is refused by RLS.
    expect(await sendMessage(outsider, 'aaa', id, { body: 'sneak' }, settings)).toMatchObject({
      ok: false,
      error: 'not_found',
    });
    await expect(
      withActorInTenant(outsider.userId, 'aaa', (tx) =>
        tx.execute(sql`
          insert into msg_messages (tenant_id, conversation_id, sender_id, body)
          values ('aaa', ${id}::uuid, ${outsider.userId}::uuid, 'forced')`),
      ),
    ).rejects.toThrow();
  });

  it('isolates tenants: a conversation in one is invisible in another', async () => {
    if (!split) return;
    const a = await member('dm-t-a', 'aaa');
    const b = await member('dm-t-b', 'aaa');
    const id = await open(a, b, 'aaa');
    await sendMessage(a, 'aaa', id, { body: 'in aaa' }, settings);
    // Same person, in bbb's context, sees nothing of their aaa conversation.
    const seen = await withActorInTenant(a.userId, 'bbb', (tx) =>
      tx.execute(sql`select id from msg_conversations where id = ${id}::uuid`),
    );
    expect([...seen]).toHaveLength(0);
  });
});

describe('direct messages service', () => {
  it('opens one conversation per pair, ordered, and reuses it', async () => {
    if (!split) return;
    const a = await member('dm-r-a');
    const b = await member('dm-r-b');
    const first = await startConversation(a, 'aaa', b.userId, settings);
    const again = await startConversation(b, 'aaa', a.userId, settings);
    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) {
      expect(again.value.id).toBe(first.value.id); // same pair, same row
      expect(first.value.created).toBe(true);
      expect(again.value.created).toBe(false);
    }
  });

  it('enforces who-can-message and refuses self', async () => {
    if (!split) return;
    const a = await member('dm-w-a');
    const u = await unverified('dm-w-u');
    // Default 'verified': an unverified recipient cannot be messaged.
    expect(await startConversation(a, 'aaa', u.userId, settings)).toMatchObject({
      ok: false,
      error: 'recipient_unavailable',
    });
    // An unverified INITIATOR cannot start one either.
    const b = await member('dm-w-b');
    expect(await startConversation(u, 'aaa', b.userId, settings)).toMatchObject({
      ok: false,
      error: 'not_verified',
    });
    // 'nobody' turns it off; 'anyone' allows the unverified recipient.
    expect(
      await startConversation(
        a,
        'aaa',
        u.userId,
        settingsSchema.parse({ whoCanMessage: 'nobody' }),
      ),
    ).toMatchObject({ ok: false, error: 'not_allowed' });
    expect(
      (
        await startConversation(
          a,
          'aaa',
          u.userId,
          settingsSchema.parse({ whoCanMessage: 'anyone' }),
        )
      ).ok,
    ).toBe(true);
    // Never yourself.
    expect(await startConversation(a, 'aaa', a.userId, settings)).toMatchObject({
      ok: false,
      error: 'self',
    });
  });

  it('tracks read receipts and unread counts', async () => {
    if (!split) return;
    const a = await member('dm-rr-a');
    const b = await member('dm-rr-b');
    const id = await open(a, b);
    await sendMessage(a, 'aaa', id, { body: 'one' }, settings);
    await sendMessage(a, 'aaa', id, { body: 'two' }, settings);
    // b has two unread; a has none (own messages never count).
    expect(await unreadCount(b.userId, 'aaa')).toBe(2);
    expect(await unreadCount(a.userId, 'aaa')).toBe(0);
    // b reads: unread clears, and a sees b's read marker on the thread.
    expect((await markRead(b, 'aaa', id)).ok).toBe(true);
    expect(await unreadCount(b.userId, 'aaa')).toBe(0);
    const asA = await thread(a, 'aaa', id);
    expect(asA?.otherLastReadAt).not.toBeNull();
    // The inbox shows the other party and a preview.
    const inbox = await listInbox(b.userId, 'aaa');
    expect(inbox[0]).toMatchObject({ otherUserId: a.userId, lastMessagePreview: 'two' });
  });

  it('edits within the window and only one’s own message', async () => {
    if (!split) return;
    const a = await member('dm-e-a');
    const b = await member('dm-e-b');
    const id = await open(a, b);
    const sent = await sendMessage(a, 'aaa', id, { body: 'typo' }, settings);
    if (!sent.ok) throw new Error('send failed');
    expect((await editMessage(a, 'aaa', sent.value.id, { body: 'fixed' }, settings)).ok).toBe(true);
    expect((await thread(a, 'aaa', id))?.messages[0]).toMatchObject({ body: 'fixed' });
    // b cannot edit a's message.
    expect(await editMessage(b, 'aaa', sent.value.id, { body: 'hijack' }, settings)).toMatchObject({
      ok: false,
      error: 'too_late',
    });
    // A zero-minute window refuses even the author.
    const late = await sendMessage(a, 'aaa', id, { body: 'later' }, settings);
    if (!late.ok) throw new Error('send failed');
    expect(
      await editMessage(
        a,
        'aaa',
        late.value.id,
        { body: 'nope' },
        settingsSchema.parse({ editWindowMinutes: 0 }),
      ),
    ).toMatchObject({ ok: false, error: 'too_late' });
  });

  it('deletes for everyone: the row stays, the words go', async () => {
    if (!split) return;
    const a = await member('dm-d-a');
    const b = await member('dm-d-b');
    const id = await open(a, b);
    const sent = await sendMessage(a, 'aaa', id, { body: 'oops' }, settings);
    if (!sent.ok) throw new Error('send failed');
    expect((await deleteForEveryone(a, 'aaa', sent.value.id, settings)).ok).toBe(true);
    const seen = (await thread(b, 'aaa', id))?.messages[0];
    expect(seen).toMatchObject({ deleted: true, body: '' });
    // b never could delete a's message.
    const other = await sendMessage(b, 'aaa', id, { body: 'mine' }, settings);
    if (!other.ok) throw new Error('send failed');
    expect(await deleteForEveryone(a, 'aaa', other.value.id, settings)).toMatchObject({
      ok: false,
      error: 'too_late',
    });
  });
});
