import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { isMember, isVerifiedMember } from './access';
import type { MessagesSettings } from './manifest';
import { editInputSchema, sendInputSchema, type EditInput, type SendInput } from './input';

/**
 * Direct-message services. Every function runs in the actor's tenant context, so
 * RLS confines what it can touch to the actor's own conversations; the checks
 * here add the tenant's policy (who may be messaged) and the edit/delete windows
 * on top. Blocks are composed at the route (the block list is another module's),
 * not here.
 */

export type SendRefusal =
  | 'not_allowed'
  | 'not_verified'
  | 'recipient_unavailable'
  | 'self'
  | 'not_found'
  | 'invalid'
  | 'rate_limited'
  | 'too_late';

/** How a conversation's messages expire. */
export const EPHEMERALITY = ['never', 'after_24h', 'after_viewing'] as const;
export type Ephemerality = (typeof EPHEMERALITY)[number];

export interface ConversationSummary {
  id: string;
  otherUserId: string;
  otherHandle: string | null;
  otherAvatarSeed: string | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unread: number;
}

export interface ThreadMessage {
  id: string;
  senderId: string;
  body: string;
  replyToId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
}

export interface Thread {
  id: string;
  otherUserId: string;
  otherHandle: string | null;
  otherAvatarSeed: string | null;
  otherLastReadAt: Date | null;
  ephemerality: string;
  messages: ThreadMessage[];
}

function toDate(v: string | Date | null): Date | null {
  return v === null ? null : v instanceof Date ? v : new Date(v);
}

/** Order a pair so it maps to one conversation row (participant_a < participant_b). */
function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/**
 * Open (or reuse) a 1:1 conversation with another member. Initiating requires a
 * verified membership; the tenant's `whoCanMessage` decides whether the other
 * party must be verified too, or whether messaging is off entirely.
 */
export async function startConversation(
  actor: { userId: string },
  tenantId: string,
  otherUserId: string,
  settings: MessagesSettings,
  ephemerality: Ephemerality = 'never',
): Promise<Result<{ id: string; created: boolean }, SendRefusal>> {
  if (otherUserId === actor.userId) return err('self');
  if (settings.whoCanMessage === 'nobody') return err('not_allowed');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (!(await isMember(tx, otherUserId, tenantId))) return err('not_found');
    if (
      settings.whoCanMessage === 'verified' &&
      !(await isVerifiedMember(tx, otherUserId, tenantId))
    )
      return err('recipient_unavailable');

    const [a, b] = orderPair(actor.userId, otherUserId);
    // New-conversations-per-day cap, counted on the actor's initiations.
    const [recent] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from msg_conversations
        where tenant_id = ${tenantId}
          and (participant_a = ${actor.userId}::uuid or participant_b = ${actor.userId}::uuid)
          and created_at > now() - interval '1 day'`)),
    ] as { n: number }[];

    // Reuse an existing pair, else create it. The unique (tenant, a, b) makes the
    // insert idempotent; a conflict means the conversation already existed.
    const inserted = [
      ...(await tx.execute(sql`
        insert into msg_conversations (tenant_id, participant_a, participant_b, ephemerality)
        values (${tenantId}, ${a}::uuid, ${b}::uuid, ${ephemerality})
        on conflict (tenant_id, participant_a, participant_b) do nothing
        returning id`)),
    ] as { id: string }[];
    let id: string;
    let created: boolean;
    if (inserted[0]) {
      if ((recent?.n ?? 0) >= settings.newConversationsPerDay) {
        // Undo: over the daily cap. (The insert ran to learn it was new.)
        await tx.execute(sql`delete from msg_conversations where id = ${inserted[0].id}::uuid`);
        return err('rate_limited');
      }
      id = inserted[0].id;
      created = true;
    } else {
      const [existing] = [
        ...(await tx.execute(sql`
          select id from msg_conversations
          where tenant_id = ${tenantId} and participant_a = ${a}::uuid and participant_b = ${b}::uuid
          limit 1`)),
      ] as { id: string }[];
      if (!existing) return err('not_found');
      id = existing.id;
      created = false;
    }
    // The initiator's own read-state row (the recipient's is made when they read).
    await tx.execute(sql`
      insert into msg_participant_state (tenant_id, conversation_id, participant_id, last_read_at)
      values (${tenantId}, ${id}::uuid, ${actor.userId}::uuid, now())
      on conflict (conversation_id, participant_id) do nothing`);
    return ok({ id, created });
  });
}

/** Send a message into a conversation the actor belongs to. */
export async function sendMessage(
  actor: { userId: string },
  tenantId: string,
  conversationId: string,
  input: SendInput,
  settings: MessagesSettings,
): Promise<Result<{ id: string }, SendRefusal>> {
  const parsed = sendInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const body = parsed.data.body;
  if (body.length > settings.maxBodyLength) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [conv] = [
      ...(await tx.execute(
        sql`select id, ephemerality from msg_conversations where id = ${conversationId}::uuid limit 1`,
      )),
    ] as { id: string; ephemerality: string }[];
    if (!conv) return err('not_found'); // RLS hides conversations the actor is not in
    // A reply-to must be a message in this same conversation (RLS-visible).
    let replyTo: string | null = null;
    if (parsed.data.replyToId) {
      const [r] = [
        ...(await tx.execute(sql`
          select id from msg_messages
          where id = ${parsed.data.replyToId}::uuid and conversation_id = ${conversationId}::uuid
          limit 1`)),
      ] as { id: string }[];
      replyTo = r ? r.id : null;
    }
    // after_24h expires at send; after_viewing is stamped on first view; never = null.
    const expires =
      conv.ephemerality === 'after_24h' ? sql`now() + interval '24 hours'` : sql`null`;
    const [row] = [
      ...(await tx.execute(sql`
        insert into msg_messages (tenant_id, conversation_id, sender_id, body, reply_to_id, expires_at)
        values (${tenantId}, ${conversationId}::uuid, ${actor.userId}::uuid, ${body}, ${replyTo}::uuid, ${expires})
        returning id`)),
    ] as { id: string }[];
    await tx.execute(sql`
      update msg_conversations set last_message_at = now() where id = ${conversationId}::uuid`);
    return ok({ id: row!.id });
  });
}

/** The actor's conversations, most-recently-active first, with an unread count. */
export async function listInbox(userId: string, tenantId: string): Promise<ConversationSummary[]> {
  return withActorInTenant(userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        with mine as (
          select c.id,
                 case when c.participant_a = ${userId}::uuid then c.participant_b else c.participant_a end as other,
                 c.last_message_at, c.created_at
          from msg_conversations c
          where c.participant_a = ${userId}::uuid or c.participant_b = ${userId}::uuid
        )
        select mine.id, mine.other, mine.last_message_at,
               p.handle as other_handle, p.avatar_seed as other_avatar_seed,
               (select case when m.deleted_at is not null then null else m.body end
                  from msg_messages m where m.conversation_id = mine.id
                    and (m.expires_at is null or m.expires_at > now())
                  order by m.created_at desc limit 1) as preview,
               (select count(*)::int from msg_messages m
                  left join msg_participant_state s
                    on s.conversation_id = mine.id and s.participant_id = ${userId}::uuid
                  where m.conversation_id = mine.id
                    and m.sender_id <> ${userId}::uuid
                    and m.deleted_at is null
                    and (m.expires_at is null or m.expires_at > now())
                    and (s.last_read_at is null or m.created_at > s.last_read_at)) as unread
        from mine
        left join public_profiles p on p.user_id = mine.other
        order by mine.last_message_at desc nulls last, mine.created_at desc`)),
    ] as Array<{
      id: string;
      other: string;
      other_handle: string | null;
      other_avatar_seed: string | null;
      last_message_at: string | Date | null;
      preview: string | null;
      unread: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      otherUserId: r.other,
      otherHandle: r.other_handle,
      otherAvatarSeed: r.other_avatar_seed,
      lastMessageAt: toDate(r.last_message_at),
      lastMessagePreview: r.preview,
      unread: r.unread ?? 0,
    }));
  });
}

/** The unread total across all the actor's conversations, for a sidebar badge. */
export async function unreadCount(userId: string, tenantId: string): Promise<number> {
  return (await listInbox(userId, tenantId)).reduce((n, c) => n + c.unread, 0);
}

/** One conversation's messages, oldest first, with the other side's read marker. */
export async function thread(
  actor: { userId: string },
  tenantId: string,
  conversationId: string,
  limit = 100,
): Promise<Thread | null> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [conv] = [
      ...(await tx.execute(sql`
        select c.id, c.ephemerality,
               case when c.participant_a = ${actor.userId}::uuid then c.participant_b else c.participant_a end as other,
               p.handle as other_handle, p.avatar_seed as other_avatar_seed
        from msg_conversations c
        left join public_profiles p
          on p.user_id = case when c.participant_a = ${actor.userId}::uuid then c.participant_b else c.participant_a end
        where c.id = ${conversationId}::uuid limit 1`)),
    ] as {
      id: string;
      ephemerality: string;
      other: string;
      other_handle: string | null;
      other_avatar_seed: string | null;
    }[];
    if (!conv) return null;
    const [otherState] = [
      ...(await tx.execute(sql`
        select last_read_at from msg_participant_state
        where conversation_id = ${conversationId}::uuid and participant_id = ${conv.other}::uuid limit 1`)),
    ] as { last_read_at: string | Date | null }[];
    const rows = [
      ...(await tx.execute(sql`
        select id, sender_id, body, reply_to_id, created_at, edited_at, deleted_at
        from msg_messages
        where conversation_id = ${conversationId}::uuid
          and (expires_at is null or expires_at > now())
        order by created_at asc, id asc
        limit ${limit}`)),
    ] as Array<{
      id: string;
      sender_id: string;
      body: string;
      reply_to_id: string | null;
      created_at: string | Date;
      edited_at: string | Date | null;
      deleted_at: string | Date | null;
    }>;
    return {
      id: conv.id,
      otherUserId: conv.other,
      otherHandle: conv.other_handle,
      otherAvatarSeed: conv.other_avatar_seed,
      otherLastReadAt: otherState ? toDate(otherState.last_read_at) : null,
      ephemerality: conv.ephemerality,
      messages: rows.map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        body: m.deleted_at ? '' : m.body,
        replyToId: m.reply_to_id,
        createdAt: toDate(m.created_at)!,
        editedAt: toDate(m.edited_at),
        deleted: m.deleted_at !== null,
      })),
    };
  });
}

/**
 * Mark the conversation read up to now, for the actor. If it is an after-viewing
 * conversation, this is also first-view: the definer stamps a short expiry on the
 * inbound messages the actor is now seeing (`graceSeconds` from the tenant setting).
 */
export async function markRead(
  actor: { userId: string },
  tenantId: string,
  conversationId: string,
  graceSeconds = 60,
): Promise<Result<{ ok: true }, SendRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [conv] = [
      ...(await tx.execute(
        sql`select id from msg_conversations where id = ${conversationId}::uuid limit 1`,
      )),
    ] as { id: string }[];
    if (!conv) return err('not_found');
    await tx.execute(sql`
      insert into msg_participant_state (tenant_id, conversation_id, participant_id, last_read_at)
      values (${tenantId}, ${conversationId}::uuid, ${actor.userId}::uuid, now())
      on conflict (conversation_id, participant_id)
      do update set last_read_at = now()`);
    // No-op unless the conversation is after_viewing (the definer checks).
    await tx.execute(
      sql`select auth_msg_stamp_viewed(${tenantId}, ${conversationId}::uuid, ${graceSeconds}::int)`,
    );
    return ok({ ok: true });
  });
}

/** Set how a conversation's messages expire. Either participant may change it. */
export async function setEphemerality(
  actor: { userId: string },
  tenantId: string,
  conversationId: string,
  value: Ephemerality,
): Promise<Result<{ ok: true }, SendRefusal>> {
  if (!EPHEMERALITY.includes(value)) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update msg_conversations set ephemerality = ${value}
        where id = ${conversationId}::uuid
        returning id`)),
    ];
    return rows.length > 0 ? ok({ ok: true }) : err('not_found');
  });
}

/** Edit one's own message, within the tenant's edit window. */
export async function editMessage(
  actor: { userId: string },
  tenantId: string,
  messageId: string,
  input: EditInput,
  settings: MessagesSettings,
): Promise<Result<{ ok: true }, SendRefusal>> {
  const parsed = editInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  if (parsed.data.body.length > settings.maxBodyLength) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update msg_messages set body = ${parsed.data.body}, edited_at = now()
        where id = ${messageId}::uuid
          and sender_id = ${actor.userId}::uuid
          and deleted_at is null
          and created_at > now() - (${settings.editWindowMinutes}::int * interval '1 minute')
        returning id`)),
    ];
    return rows.length > 0 ? ok({ ok: true }) : err('too_late');
  });
}

/** Delete one's own message for everyone, within the tenant's delete window. */
export async function deleteForEveryone(
  actor: { userId: string },
  tenantId: string,
  messageId: string,
  settings: MessagesSettings,
): Promise<Result<{ ok: true }, SendRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update msg_messages set deleted_at = now(), body = ''
        where id = ${messageId}::uuid
          and sender_id = ${actor.userId}::uuid
          and deleted_at is null
          and created_at > now() - (${settings.deleteEveryoneWindowMinutes}::int * interval '1 minute')
        returning id`)),
    ];
    return rows.length > 0 ? ok({ ok: true }) : err('too_late');
  });
}
