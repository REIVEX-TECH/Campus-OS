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
  acceptRequest,
  conversationBetween,
  declineRequest,
  deleteForEveryone,
  editMessage,
  listInbox,
  listRequests,
  markRead,
  requestCount,
  sendMessage,
  setEphemerality,
  setTyping,
  startConversation,
  thread,
  unreadCount,
} from '../src/service';
import { moderationQueue, reportMessage, resolveReports } from '../src/moderation';
import { expireMessages } from '../src/expiry';

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

/**
 * Open an EMPTY ACTIVE conversation for tests that just need a live thread: send the
 * seed request, accept it, and clear the seed message (as the owner) so the thread
 * starts empty. Tests that exercise the request lifecycle itself use
 * startConversation / acceptRequest / declineRequest directly instead.
 */
async function open(a: { userId: string }, b: { userId: string }, tenant = 'aaa') {
  const res = await startConversation(a, tenant, b.userId, 'hi', settings);
  if (!res.ok) throw new Error(`start failed: ${res.error}`);
  const acc = await acceptRequest(b, tenant, res.value.id);
  if (!acc.ok) throw new Error(`accept failed: ${acc.error}`);
  await runAsMigrationRole(`delete from msg_messages where conversation_id = '${res.value.id}'`);
  return res.value.id;
}

/** A verified tenant administrator (holds messages.moderate), seeded as the owner. */
async function admin(subject: string, tenant = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
  await runAsMigrationRole(
    `select auth_sync_tenant_roles('${tenant}')`,
    `insert into tenant_memberships (tenant_id, user_id, role, status, verified_at, verification_method)
       values ('${tenant}', '${actor.userId}', 'tenant_admin', 'active', now(), 'admin')
       on conflict (tenant_id, user_id) do update
         set role = 'tenant_admin',
             verified_at = coalesce(tenant_memberships.verified_at, now()),
             verification_method = coalesce(tenant_memberships.verification_method, 'admin')`,
    `insert into membership_roles (membership_id, role_id, tenant_id, user_id)
       select m.id, r.id, m.tenant_id, m.user_id
       from tenant_memberships m
       join roles r on r.tenant_id = m.tenant_id and r.key = 'tenant_admin'
       where m.tenant_id = '${tenant}' and m.user_id = '${actor.userId}'
       on conflict (membership_id, role_id) do nothing`,
  );
  return actor;
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
    const first = await startConversation(a, 'aaa', b.userId, 'hi', settings);
    const again = await startConversation(b, 'aaa', a.userId, 'hello back', settings);
    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) {
      expect(again.value.id).toBe(first.value.id); // same pair, same row
      expect(first.value.created).toBe(true);
      expect(again.value.created).toBe(false); // b replying accepts the request
    }
  });

  it('enforces who-can-message and refuses self', async () => {
    if (!split) return;
    const a = await member('dm-w-a');
    const u = await unverified('dm-w-u');
    // Default 'verified': an unverified recipient cannot be messaged.
    expect(await startConversation(a, 'aaa', u.userId, 'hi', settings)).toMatchObject({
      ok: false,
      error: 'recipient_unavailable',
    });
    // An unverified INITIATOR cannot start one either.
    const b = await member('dm-w-b');
    expect(await startConversation(u, 'aaa', b.userId, 'hi', settings)).toMatchObject({
      ok: false,
      error: 'not_verified',
    });
    // 'nobody' turns it off; 'anyone' allows the unverified recipient.
    expect(
      await startConversation(
        a,
        'aaa',
        u.userId,
        'hi',
        settingsSchema.parse({ whoCanMessage: 'nobody' }),
      ),
    ).toMatchObject({ ok: false, error: 'not_allowed' });
    expect(
      (
        await startConversation(
          a,
          'aaa',
          u.userId,
          'hi',
          settingsSchema.parse({ whoCanMessage: 'anyone' }),
        )
      ).ok,
    ).toBe(true);
    // Never yourself.
    expect(await startConversation(a, 'aaa', a.userId, 'hi', settings)).toMatchObject({
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

describe('direct messages moderation', () => {
  it('reports a message with a snapshot a moderator reads, and resolves it', async () => {
    if (!split) return;
    const a = await member('dm-mod-a');
    const b = await member('dm-mod-b');
    const id = await open(a, b);
    await sendMessage(a, 'aaa', id, { body: 'before' }, settings);
    const bad = await sendMessage(a, 'aaa', id, { body: 'the bad one' }, settings);
    await sendMessage(b, 'aaa', id, { body: 'after' }, settings);
    if (!bad.ok) throw new Error('send failed');

    // b reports a's message; the snapshot carries the words and the context.
    expect(await reportMessage(b, 'aaa', bad.value.id, 'harassment', 'not ok')).toMatchObject({
      ok: true,
      value: { reported: true },
    });
    // One per reporter per message.
    expect(await reportMessage(b, 'aaa', bad.value.id, 'harassment', null)).toMatchObject({
      ok: true,
      value: { reported: false },
    });

    // A non-moderator (either participant) sees an empty queue (definer-gated).
    expect((await moderationQueue(a, 'aaa')).length).toBe(0);
    expect((await moderationQueue(b, 'aaa')).length).toBe(0);

    // A moderator sees the report and its snapshot, though they are not a participant.
    const mod = await admin('dm-mod-adm');
    const queue = await moderationQueue(mod, 'aaa');
    const mine = queue.find((r) => r.messageId === bad.value.id);
    expect(mine?.snapshot.message?.body).toBe('the bad one');
    expect(mine?.snapshot.context.map((m) => m.body)).toEqual(['before', 'the bad one', 'after']);

    // A non-moderator cannot resolve; a moderator removes it (tombstoned) and the queue clears.
    expect((await resolveReports(b, 'aaa', bad.value.id, 'removed')).ok).toBe(true);
    expect((await moderationQueue(mod, 'aaa')).length).toBe(1); // b's resolve did nothing
    expect((await resolveReports(mod, 'aaa', bad.value.id, 'removed')).ok).toBe(true);
    expect((await moderationQueue(mod, 'aaa')).length).toBe(0);
    // The message is now a tombstone in the thread.
    const seen = (await thread(a, 'aaa', id))?.messages.find((m) => m.id === bad.value.id);
    expect(seen).toMatchObject({ deleted: true, body: '' });
  });

  it('refuses a report on a message the reporter cannot see', async () => {
    if (!split) return;
    const a = await member('dm-mod2-a');
    const b = await member('dm-mod2-b');
    const outsider = await member('dm-mod2-out');
    const id = await open(a, b);
    const m = await sendMessage(a, 'aaa', id, { body: 'private' }, settings);
    if (!m.ok) throw new Error('send failed');
    expect(await reportMessage(outsider, 'aaa', m.value.id, 'spam', null)).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('direct messages ephemerality', () => {
  /** Force a message's expiry, as the owner, to simulate time passing. */
  async function setExpiry(id: string, expr: string) {
    await runAsMigrationRole(`update msg_messages set expires_at = ${expr} where id = '${id}'`);
  }

  it('stamps after_24h at send, and hides + sweeps a message past its window', async () => {
    if (!split) return;
    const a = await member('dm-e24-a');
    const b = await member('dm-e24-b');
    // An empty active chat, then turn on after_24h and send into it.
    const id = await open(a, b);
    expect((await setEphemerality(a, 'aaa', id, 'after_24h')).ok).toBe(true);
    const sent = await sendMessage(a, 'aaa', id, { body: 'poof soon' }, settings);
    if (!sent.ok) throw new Error('send failed');
    // Visible while fresh.
    expect((await thread(b, 'aaa', id))?.messages.map((m) => m.body)).toEqual(['poof soon']);
    // Force it past the window: hidden from reads, then hard-deleted by the sweep.
    await setExpiry(sent.value.id, `now() - interval '1 minute'`);
    expect((await thread(b, 'aaa', id))?.messages).toEqual([]);
    expect(await unreadCount(b.userId, 'aaa')).toBe(0);
    await expireMessages('aaa');
    // Gone from the table: a participant's raw read (RLS shows them all their own
    // messages, expiry-hiding is applied in the service, not the policy) finds none.
    const stillThere = await withActorInTenant(a.userId, 'aaa', (tx) =>
      tx.execute(sql`select id from msg_messages where id = ${sent.value.id}::uuid`),
    );
    expect([...stillThere]).toHaveLength(0);
  });

  it('stamps after_viewing only when the recipient reads, not before', async () => {
    if (!split) return;
    const a = await member('dm-ev-a');
    const b = await member('dm-ev-b');
    // An empty active chat, then turn on after_viewing and send into it.
    const id = await open(a, b);
    expect((await setEphemerality(a, 'aaa', id, 'after_viewing')).ok).toBe(true);
    const sent = await sendMessage(a, 'aaa', id, { body: 'read then gone' }, settings);
    if (!sent.ok) throw new Error('send failed');
    // Unread by b: no expiry yet.
    const [beforeView] = [
      ...(await withActorInTenant(a.userId, 'aaa', (tx) =>
        tx.execute(sql`select expires_at from msg_messages where id = ${sent.value.id}::uuid`),
      )),
    ] as { expires_at: string | null }[];
    expect(beforeView?.expires_at).toBeNull();
    // b reads: the message it received now has an expiry.
    expect((await markRead(b, 'aaa', id, 60)).ok).toBe(true);
    const [afterView] = [
      ...(await withActorInTenant(a.userId, 'aaa', (tx) =>
        tx.execute(sql`select expires_at from msg_messages where id = ${sent.value.id}::uuid`),
      )),
    ] as { expires_at: string | null }[];
    expect(afterView?.expires_at).not.toBeNull();
  });

  it('lets a participant change the disappearing mode', async () => {
    if (!split) return;
    const a = await member('dm-set-a');
    const b = await member('dm-set-b');
    const id = await open(a, b);
    expect((await setEphemerality(b, 'aaa', id, 'after_24h')).ok).toBe(true);
    const sent = await sendMessage(a, 'aaa', id, { body: 'now ephemeral' }, settings);
    if (!sent.ok) throw new Error('send failed');
    const [row] = [
      ...(await withActorInTenant(a.userId, 'aaa', (tx) =>
        tx.execute(sql`select expires_at from msg_messages where id = ${sent.value.id}::uuid`),
      )),
    ] as { expires_at: string | null }[];
    expect(row?.expires_at).not.toBeNull();
  });
});

describe('direct messages requests', () => {
  it('opens as a request: one message from the requester, the recipient accepts', async () => {
    if (!split) return;
    const a = await member('dm-req-a');
    const b = await member('dm-req-b');
    const res = await startConversation(a, 'aaa', b.userId, 'can we talk?', settings);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const id = res.value.id;
    // The request already holds the one message; a second while pending is refused.
    expect(await sendMessage(a, 'aaa', id, { body: 'please' }, settings)).toMatchObject({
      ok: false,
      error: 'not_allowed',
    });
    // Not in the recipient's inbox; it is in their requests, once, with the message.
    expect(await listInbox(b.userId, 'aaa')).toHaveLength(0);
    const reqs = await listRequests(b.userId, 'aaa');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ fromUserId: a.userId, message: 'can we talk?' });
    expect(await requestCount(b.userId, 'aaa')).toBe(1);
    // The recipient's reply accepts it: active, in both inboxes, no longer a request.
    expect((await sendMessage(b, 'aaa', id, { body: 'sure' }, settings)).ok).toBe(true);
    expect(await requestCount(b.userId, 'aaa')).toBe(0);
    expect((await listInbox(b.userId, 'aaa')).map((c) => c.id)).toContain(id);
    expect((await listInbox(a.userId, 'aaa')).map((c) => c.id)).toContain(id);
    // The requester can now send freely.
    expect((await sendMessage(a, 'aaa', id, { body: 'thanks' }, settings)).ok).toBe(true);
  });

  it('shows the requester their own request as an outbound "sent" entry, not a request', async () => {
    if (!split) return;
    const a = await member('dm-out-a');
    const b = await member('dm-out-b');
    const res = await startConversation(a, 'aaa', b.userId, 'hi', settings);
    if (!res.ok) throw new Error(res.error);
    const outbox = await listInbox(a.userId, 'aaa');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ id: res.value.id, outbound: true });
    expect(await requestCount(a.userId, 'aaa')).toBe(0);
    // The recipient can accept it explicitly, without replying.
    expect((await acceptRequest(b, 'aaa', res.value.id)).ok).toBe(true);
    expect((await listInbox(a.userId, 'aaa'))[0]).toMatchObject({ outbound: false });
  });

  it('declines: hidden from the recipient, still "sent" for the requester', async () => {
    if (!split) return;
    const a = await member('dm-dec-a');
    const b = await member('dm-dec-b');
    const res = await startConversation(a, 'aaa', b.userId, 'hello', settings);
    if (!res.ok) throw new Error(res.error);
    const id = res.value.id;
    // Only the recipient may accept/decline; the requester cannot.
    expect(await declineRequest(a, 'aaa', id)).toMatchObject({ ok: false, error: 'not_recipient' });
    expect((await declineRequest(b, 'aaa', id)).ok).toBe(true);
    // Gone from the recipient's requests and inbox...
    expect(await listRequests(b.userId, 'aaa')).toHaveLength(0);
    expect(await listInbox(b.userId, 'aaa')).toHaveLength(0);
    // ...still the requester's own sent state.
    const outbox = await listInbox(a.userId, 'aaa');
    expect(outbox.map((c) => c.id)).toEqual([id]);
    expect(outbox[0]?.outbound).toBe(true);
    // No pushing another message into a declined request.
    expect(await sendMessage(a, 'aaa', id, { body: 'again?' }, settings)).toMatchObject({
      ok: false,
      error: 'not_allowed',
    });
  });

  it('bars the same requester from re-requesting a declined person for 30 days', async () => {
    if (!split) return;
    const a = await member('dm-30-a');
    const b = await member('dm-30-b');
    const res = await startConversation(a, 'aaa', b.userId, 'hi', settings);
    if (!res.ok) throw new Error(res.error);
    expect((await declineRequest(b, 'aaa', res.value.id)).ok).toBe(true);
    // Immediately re-requesting is refused.
    expect(await startConversation(a, 'aaa', b.userId, 'again?', settings)).toMatchObject({
      ok: false,
      error: 'declined_recently',
    });
    // Past the window, a fresh request re-opens the row with its new message.
    await runAsMigrationRole(
      `update msg_conversations set status_changed_at = now() - interval '31 days' where id = '${res.value.id}'`,
    );
    const again = await startConversation(a, 'aaa', b.userId, 'still keen', settings);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect((await thread(a, 'aaa', again.value.id))?.status).toBe('pending');
      // The recipient sees exactly the new message as the request, not the old one.
      expect((await listRequests(b.userId, 'aaa')).map((r) => r.message)).toEqual(['still keen']);
    }
  });

  it('does not stamp ephemerality while pending; the clock starts once active', async () => {
    if (!split) return;
    const a = await member('dm-peph-a');
    const b = await member('dm-peph-b');
    const res = await startConversation(a, 'aaa', b.userId, 'request', settings, 'after_24h');
    if (!res.ok) throw new Error(res.error);
    const id = res.value.id;
    // The recipient's reply accepts and becomes active.
    await sendMessage(b, 'aaa', id, { body: 'ok' }, settings);
    const rows = [
      ...(await withActorInTenant(b.userId, 'aaa', (tx) =>
        tx.execute(sql`
          select body, expires_at from msg_messages
          where conversation_id = ${id}::uuid order by created_at asc`),
      )),
    ] as { body: string; expires_at: string | null }[];
    // The pending request message never got an expiry; the first active one did.
    expect(rows.find((r) => r.body === 'request')?.expires_at).toBeNull();
    expect(rows.find((r) => r.body === 'ok')?.expires_at).not.toBeNull();
  });

  it('shows the other side typing in an active chat, never while pending', async () => {
    if (!split) return;
    const a = await member('dm-ty-a');
    const b = await member('dm-ty-b');
    const id = await open(a, b);
    // a is typing: b's thread sees it; a's own does not.
    expect((await setTyping(a, 'aaa', id, true)).ok).toBe(true);
    expect((await thread(b, 'aaa', id))?.otherTyping).toBe(true);
    expect((await thread(a, 'aaa', id))?.otherTyping).toBe(false);
    // Cleared on send/blur.
    expect((await setTyping(a, 'aaa', id, false)).ok).toBe(true);
    expect((await thread(b, 'aaa', id))?.otherTyping).toBe(false);
    // A pending request never advertises typing (setTyping is a no-op there).
    const c = await member('dm-ty-c');
    const req = await startConversation(a, 'aaa', c.userId, 'hi', settings);
    if (!req.ok) throw new Error(req.error);
    expect((await setTyping(a, 'aaa', req.value.id, true)).ok).toBe(true);
    expect((await thread(c, 'aaa', req.value.id))?.otherTyping).toBe(false);
  });

  it('cannot create a request without a message', async () => {
    if (!split) return;
    const a = await member('dm-nm-a');
    const b = await member('dm-nm-b');
    // A blank message is refused and creates nothing.
    expect(await startConversation(a, 'aaa', b.userId, '   ', settings)).toMatchObject({
      ok: false,
      error: 'invalid',
    });
    expect(await conversationBetween(a, 'aaa', b.userId)).toBeNull();
    // A real request creates the conversation and its one message together.
    const res = await startConversation(a, 'aaa', b.userId, 'first', settings);
    expect(res.ok && res.value.created).toBe(true);
    expect((await listRequests(b.userId, 'aaa'))[0]?.message).toBe('first');
    if (res.ok) {
      // No empty pending exists: the request already carries its message, and a
      // second from the requester while pending is refused.
      expect(await sendMessage(a, 'aaa', res.value.id, { body: 'more' }, settings)).toMatchObject({
        ok: false,
        error: 'not_allowed',
      });
    }
  });
});
