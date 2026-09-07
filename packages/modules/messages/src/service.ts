import { sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
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
  | 'declined_recently'
  | 'too_late';

/** Accept/decline a request. */
export type RequestRefusal = 'not_found' | 'not_pending' | 'not_recipient';

/** How a conversation's messages expire. */
export const EPHEMERALITY = ['never', 'after_24h', 'after_viewing'] as const;
export type Ephemerality = (typeof EPHEMERALITY)[number];

/** How long a declined request bars the same requester from re-requesting. */
const REREQUEST_BLOCK_DAYS = 30;

export interface ConversationSummary {
  id: string;
  otherUserId: string;
  otherHandle: string | null;
  otherAvatarSeed: string | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unread: number;
  /** True when this is the actor's own outbound request (shown as "Request sent"). */
  outbound: boolean;
}

/** An inbound request awaiting the actor's accept/decline. */
export interface RequestSummary {
  id: string;
  fromUserId: string;
  fromHandle: string | null;
  fromAvatarSeed: string | null;
  message: string | null;
  createdAt: Date;
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
  /** 'pending' | 'active' | 'declined'. */
  status: string;
  /** True when the actor is the one who opened this (still-)request. */
  isRequester: boolean;
  /** Whether the actor may send right now (false for a sent-but-unaccepted request). */
  canSend: boolean;
  /** Whether the other participant is typing right now (active chats only). */
  otherTyping: boolean;
  messages: ThreadMessage[];
}

function toDate(v: string | Date | null): Date | null {
  return v === null ? null : v instanceof Date ? v : new Date(v);
}

/** Order a pair so it maps to one conversation row (participant_a < participant_b). */
function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** The initiator's own read-state row (the recipient's is made when they read). */
async function ensureOwnState(
  tx: TenantTransaction,
  tenantId: string,
  conversationId: string,
  userId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into msg_participant_state (tenant_id, conversation_id, participant_id, last_read_at)
    values (${tenantId}, ${conversationId}::uuid, ${userId}::uuid, now())
    on conflict (conversation_id, participant_id) do nothing`);
}

/** How many requests this actor has opened (or re-opened) in the last day. */
async function recentInitiations(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
): Promise<number> {
  const [r] = [
    ...(await tx.execute(sql`
      select count(*)::int as n from msg_conversations
      where tenant_id = ${tenantId} and requested_by = ${userId}::uuid
        and status_changed_at > now() - interval '1 day'`)),
  ] as { n: number }[];
  return r?.n ?? 0;
}

/**
 * Insert a message into a conversation and bump its last-activity. Ephemerality is
 * stamped only when the conversation is active (a pending request never expires);
 * after_viewing is stamped on first view, not here.
 */
async function insertMessage(
  tx: TenantTransaction,
  tenantId: string,
  conversationId: string,
  senderId: string,
  body: string,
  convEphemerality: string,
  isActive: boolean,
): Promise<string> {
  const expires =
    isActive && convEphemerality === 'after_24h' ? sql`now() + interval '24 hours'` : sql`null`;
  const [row] = [
    ...(await tx.execute(sql`
      insert into msg_messages (tenant_id, conversation_id, sender_id, body, expires_at)
      values (${tenantId}, ${conversationId}::uuid, ${senderId}::uuid, ${body}, ${expires})
      returning id`)),
  ] as { id: string }[];
  await tx.execute(
    sql`update msg_conversations set last_message_at = now() where id = ${conversationId}::uuid`,
  );
  return row!.id;
}

/**
 * Open a 1:1 conversation with another member by sending the first message. A NEW
 * conversation IS a request (status 'pending', the actor as `requested_by`) and is
 * created together with that first message in one transaction, so a request never
 * exists without a message. If a conversation already exists the message lands in
 * it (accepting an inbound request, or continuing an active chat); a request the
 * recipient DECLINED bars the same requester for 30 days, then re-opens.
 *
 * Initiating requires a verified membership; the tenant's `whoCanMessage` decides
 * whether the other party must be verified too, or whether messaging is off. Blocks
 * are checked at the route.
 */
export async function startConversation(
  actor: { userId: string },
  tenantId: string,
  otherUserId: string,
  body: string,
  settings: MessagesSettings,
  ephemerality: Ephemerality = 'never',
): Promise<Result<{ id: string; created: boolean }, SendRefusal>> {
  if (otherUserId === actor.userId) return err('self');
  if (settings.whoCanMessage === 'nobody') return err('not_allowed');
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > settings.maxBodyLength) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    if (!(await isMember(tx, otherUserId, tenantId))) return err('not_found');
    if (
      settings.whoCanMessage === 'verified' &&
      !(await isVerifiedMember(tx, otherUserId, tenantId))
    )
      return err('recipient_unavailable');

    const [a, b] = orderPair(actor.userId, otherUserId);
    // Lock the pair's row if it exists, so a decline/re-request decision is atomic.
    const [existing] = [
      ...(await tx.execute(sql`
        select id, status, requested_by, status_changed_at, ephemerality
        from msg_conversations
        where tenant_id = ${tenantId} and participant_a = ${a}::uuid and participant_b = ${b}::uuid
        for update`)),
    ] as {
      id: string;
      status: string;
      requested_by: string | null;
      status_changed_at: string | Date | null;
      ephemerality: string;
    }[];

    if (existing) {
      if (existing.status === 'active') {
        // An open chat: this is a normal message into it.
        await ensureOwnState(tx, tenantId, existing.id, actor.userId);
        await insertMessage(
          tx,
          tenantId,
          existing.id,
          actor.userId,
          trimmed,
          existing.ephemerality,
          true,
        );
        return ok({ id: existing.id, created: false });
      }
      if (existing.status === 'pending') {
        if (existing.requested_by === actor.userId) return err('not_allowed'); // request already sent
        // The recipient's message accepts the inbound request.
        await tx.execute(sql`
          update msg_conversations set status = 'active', status_changed_at = now()
          where id = ${existing.id}::uuid`);
        await ensureOwnState(tx, tenantId, existing.id, actor.userId);
        await insertMessage(
          tx,
          tenantId,
          existing.id,
          actor.userId,
          trimmed,
          existing.ephemerality,
          true,
        );
        return ok({ id: existing.id, created: false });
      }
      // Declined. The original requester is barred for the re-request window; after
      // it (or coming from the other party) a fresh request re-opens the row.
      const changed = toDate(existing.status_changed_at);
      const withinBlock =
        changed !== null &&
        changed.getTime() > Date.now() - REREQUEST_BLOCK_DAYS * 24 * 60 * 60 * 1000;
      if (existing.requested_by === actor.userId && withinBlock) return err('declined_recently');
      if ((await recentInitiations(tx, tenantId, actor.userId)) >= settings.newConversationsPerDay)
        return err('rate_limited');
      await tx.execute(sql`
        update msg_conversations
           set status = 'pending', requested_by = ${actor.userId}::uuid,
               status_changed_at = now(), ephemerality = ${ephemerality}
         where id = ${existing.id}::uuid`);
      await ensureOwnState(tx, tenantId, existing.id, actor.userId);
      await insertMessage(tx, tenantId, existing.id, actor.userId, trimmed, ephemerality, false);
      return ok({ id: existing.id, created: false });
    }

    // A brand-new pair: open a pending request with its first message.
    if ((await recentInitiations(tx, tenantId, actor.userId)) >= settings.newConversationsPerDay)
      return err('rate_limited');
    const inserted = [
      ...(await tx.execute(sql`
        insert into msg_conversations
          (tenant_id, participant_a, participant_b, ephemerality, status, requested_by, status_changed_at)
        values (${tenantId}, ${a}::uuid, ${b}::uuid, ${ephemerality}, 'pending', ${actor.userId}::uuid, now())
        on conflict (tenant_id, participant_a, participant_b) do nothing
        returning id`)),
    ] as { id: string }[];
    if (!inserted[0]) return err('not_allowed'); // lost a race to a concurrent open
    await ensureOwnState(tx, tenantId, inserted[0].id, actor.userId);
    await insertMessage(tx, tenantId, inserted[0].id, actor.userId, trimmed, ephemerality, false);
    return ok({ id: inserted[0].id, created: true });
  });
}

/**
 * The conversation between the actor and another member, if one exists (any
 * status). Lets the profile Message button decide whether to open the compose
 * sheet (no conversation yet) or link straight to an existing thread.
 */
export async function conversationBetween(
  actor: { userId: string },
  tenantId: string,
  otherUserId: string,
): Promise<{ id: string; status: string; isRequester: boolean } | null> {
  if (otherUserId === actor.userId) return null;
  const [a, b] = orderPair(actor.userId, otherUserId);
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select id, status, requested_by from msg_conversations
        where tenant_id = ${tenantId} and participant_a = ${a}::uuid and participant_b = ${b}::uuid
        limit 1`)),
    ] as { id: string; status: string; requested_by: string | null }[];
    if (!row) return null;
    return { id: row.id, status: row.status, isRequester: row.requested_by === actor.userId };
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
      ...(await tx.execute(sql`
        select id, ephemerality, status, requested_by, status_changed_at
        from msg_conversations where id = ${conversationId}::uuid for update`)),
    ] as {
      id: string;
      ephemerality: string;
      status: string;
      requested_by: string | null;
      status_changed_at: string | Date | null;
    }[];
    if (!conv) return err('not_found'); // RLS hides conversations the actor is not in

    // Request rules. A declined request is closed to the requester (they still see
    // "Request sent"); a pending one holds the requester's single message, and the
    // recipient's first message accepts it.
    let status = conv.status;
    if (status === 'declined') return err('not_allowed');
    if (status === 'pending') {
      if (conv.requested_by === actor.userId) {
        // One message per request: count only messages since the request opened
        // (status_changed_at), so a re-request after a decline starts fresh without
        // deleting the old thread.
        const [cnt] = [
          ...(await tx.execute(sql`
            select count(*)::int as n from msg_messages
            where conversation_id = ${conversationId}::uuid
              and created_at >= ${conv.status_changed_at}::timestamptz`)),
        ] as { n: number }[];
        if ((cnt?.n ?? 0) >= 1) return err('not_allowed');
      } else {
        await tx.execute(sql`
          update msg_conversations set status = 'active', status_changed_at = now()
          where id = ${conversationId}::uuid`);
        status = 'active';
      }
    }

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
    // Ephemerality applies only once active: a pending request message never
    // expires (a request accepted later starts the clock only on later messages).
    // after_24h expires at send; after_viewing is stamped on first view; never = null.
    const expires =
      status === 'active' && conv.ephemerality === 'after_24h'
        ? sql`now() + interval '24 hours'`
        : sql`null`;
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
                 c.last_message_at, c.created_at, c.status
          from msg_conversations c
          where (c.participant_a = ${userId}::uuid or c.participant_b = ${userId}::uuid)
            and (
              c.status = 'active'
              or (c.requested_by = ${userId}::uuid and c.status in ('pending', 'declined'))
            )
        )
        select mine.id, mine.other, mine.last_message_at,
               (mine.status <> 'active') as outbound,
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
      outbound: boolean;
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
      outbound: r.outbound === true,
    }));
  });
}

/** The unread total across all the actor's conversations, for a sidebar badge. */
export async function unreadCount(userId: string, tenantId: string): Promise<number> {
  return (await listInbox(userId, tenantId)).reduce((n, c) => n + c.unread, 0);
}

/**
 * The requests awaiting this actor's decision: pending conversations they did not
 * open. Kept out of the inbox and counted separately from unread.
 */
export async function listRequests(userId: string, tenantId: string): Promise<RequestSummary[]> {
  return withActorInTenant(userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select c.id,
               case when c.participant_a = ${userId}::uuid then c.participant_b else c.participant_a end as from_user,
               c.created_at,
               p.handle as from_handle, p.avatar_seed as from_avatar_seed,
               -- the request's own message: the one sent since this request opened
               -- (so a re-request shows its new message, not the declined thread's).
               (select m.body from msg_messages m
                  where m.conversation_id = c.id and m.created_at >= c.status_changed_at
                  order by m.created_at asc limit 1) as message
        from msg_conversations c
        left join public_profiles p
          on p.user_id = case when c.participant_a = ${userId}::uuid then c.participant_b else c.participant_a end
        where (c.participant_a = ${userId}::uuid or c.participant_b = ${userId}::uuid)
          and c.status = 'pending'
          and c.requested_by <> ${userId}::uuid
        order by c.created_at desc`)),
    ] as Array<{
      id: string;
      from_user: string;
      from_handle: string | null;
      from_avatar_seed: string | null;
      message: string | null;
      created_at: string | Date;
    }>;
    return rows.map((r) => ({
      id: r.id,
      fromUserId: r.from_user,
      fromHandle: r.from_handle,
      fromAvatarSeed: r.from_avatar_seed,
      message: r.message,
      createdAt: toDate(r.created_at)!,
    }));
  });
}

/** How many requests await this actor's decision (for the tab count). */
export async function requestCount(userId: string, tenantId: string): Promise<number> {
  return withActorInTenant(userId, tenantId, async (tx) => {
    const [r] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from msg_conversations c
        where (c.participant_a = ${userId}::uuid or c.participant_b = ${userId}::uuid)
          and c.status = 'pending' and c.requested_by <> ${userId}::uuid`)),
    ] as { n: number }[];
    return r?.n ?? 0;
  });
}

/**
 * The other participant of a conversation the actor is in, or null. Lets the web
 * route run the bidirectional block check (a communities capability) without the
 * messages module reading another module's tables.
 */
export async function otherParticipant(
  actor: { userId: string },
  tenantId: string,
  conversationId: string,
): Promise<string | null> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select case when participant_a = ${actor.userId}::uuid then participant_b else participant_a end as other
        from msg_conversations where id = ${conversationId}::uuid limit 1`)),
    ] as { other: string }[];
    return row?.other ?? null;
  });
}

/** Why an accept/decline did not apply, for a precise refusal. */
async function requestRefusal(
  tx: TenantTransaction,
  conversationId: string,
): Promise<RequestRefusal> {
  const [conv] = [
    ...(await tx.execute(
      sql`select status, requested_by from msg_conversations where id = ${conversationId}::uuid limit 1`,
    )),
  ] as { status: string; requested_by: string | null }[];
  if (!conv) return 'not_found';
  if (conv.status !== 'pending') return 'not_pending';
  return 'not_recipient'; // pending, but the actor is the requester
}

/** The recipient accepts a request: the conversation becomes an active chat. */
export async function acceptRequest(
  actor: { userId: string },
  tenantId: string,
  conversationId: string,
): Promise<Result<{ ok: true }, RequestRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    // Only activate a request that actually carries a message. A request is always
    // created with its first message, so this holds for every real one; the guard
    // means accept can never mint an active conversation with zero messages (which
    // would read as "No messages yet" in an inbox).
    const rows = [
      ...(await tx.execute(sql`
        update msg_conversations set status = 'active', status_changed_at = now()
        where id = ${conversationId}::uuid and status = 'pending'
          and requested_by <> ${actor.userId}::uuid
          and exists (select 1 from msg_messages m where m.conversation_id = ${conversationId}::uuid)
        returning id`)),
    ];
    if (rows.length > 0) return ok({ ok: true });
    return err(await requestRefusal(tx, conversationId));
  });
}

/**
 * The recipient declines a request. The requester is not notified; they keep
 * seeing "Request sent". Blocking on decline is composed at the route.
 */
export async function declineRequest(
  actor: { userId: string },
  tenantId: string,
  conversationId: string,
): Promise<Result<{ ok: true }, RequestRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update msg_conversations set status = 'declined', status_changed_at = now()
        where id = ${conversationId}::uuid and status = 'pending'
          and requested_by <> ${actor.userId}::uuid
        returning id`)),
    ];
    if (rows.length > 0) return ok({ ok: true });
    return err(await requestRefusal(tx, conversationId));
  });
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
        select c.id, c.ephemerality, c.status, c.requested_by, c.status_changed_at,
               case when c.participant_a = ${actor.userId}::uuid then c.participant_b else c.participant_a end as other,
               p.handle as other_handle, p.avatar_seed as other_avatar_seed
        from msg_conversations c
        left join public_profiles p
          on p.user_id = case when c.participant_a = ${actor.userId}::uuid then c.participant_b else c.participant_a end
        where c.id = ${conversationId}::uuid limit 1`)),
    ] as {
      id: string;
      ephemerality: string;
      status: string;
      requested_by: string | null;
      status_changed_at: string | Date | null;
      other: string;
      other_handle: string | null;
      other_avatar_seed: string | null;
    }[];
    if (!conv) return null;
    // Whether the actor may send now: always when active; a recipient replying to a
    // pending request accepts it; a requester may send only the one request message.
    let canSend = conv.status === 'active';
    if (conv.status === 'pending') {
      if (conv.requested_by !== actor.userId) {
        canSend = true;
      } else {
        const [c] = [
          ...(await tx.execute(sql`
            select count(*)::int as n from msg_messages
            where conversation_id = ${conversationId}::uuid
              and created_at >= ${conv.status_changed_at}::timestamptz`)),
        ] as { n: number }[];
        canSend = (c?.n ?? 0) === 0;
      }
    }
    const [otherState] = [
      ...(await tx.execute(sql`
        select last_read_at, typing_until from msg_participant_state
        where conversation_id = ${conversationId}::uuid and participant_id = ${conv.other}::uuid limit 1`)),
    ] as { last_read_at: string | Date | null; typing_until: string | Date | null }[];
    const otherTypingUntil = otherState ? toDate(otherState.typing_until) : null;
    const otherTyping =
      conv.status === 'active' &&
      otherTypingUntil !== null &&
      otherTypingUntil.getTime() > Date.now();
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
      status: conv.status,
      isRequester: conv.requested_by === actor.userId,
      canSend,
      otherTyping,
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
        sql`select id, status from msg_conversations where id = ${conversationId}::uuid limit 1`,
      )),
    ] as { id: string; status: string }[];
    if (!conv) return err('not_found');
    // Opening a request does not mark it read, and never triggers after-viewing
    // expiry; read state and the view stamp begin once the conversation is active.
    if (conv.status !== 'active') return ok({ ok: true });
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

/** Seconds a typing heartbeat keeps "typing" alive before it lapses. */
const TYPING_TTL_SECONDS = 5;

/**
 * Heartbeat (or clear) the actor's typing state on a conversation. `on` extends it
 * a few seconds; the composer refreshes it every couple of seconds while typing and
 * clears it (`on=false`) on send or blur. Only in active conversations; a no-op
 * otherwise, so a pending request never advertises typing.
 */
export async function setTyping(
  actor: { userId: string },
  tenantId: string,
  conversationId: string,
  on: boolean,
): Promise<Result<{ ok: true }, SendRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [conv] = [
      ...(await tx.execute(
        sql`select id, status from msg_conversations where id = ${conversationId}::uuid limit 1`,
      )),
    ] as { id: string; status: string }[];
    if (!conv) return err('not_found');
    if (conv.status !== 'active') return ok({ ok: true });
    const until = on ? sql`now() + (${TYPING_TTL_SECONDS}::int * interval '1 second')` : sql`null`;
    await tx.execute(sql`
      insert into msg_participant_state (tenant_id, conversation_id, participant_id, typing_until)
      values (${tenantId}, ${conversationId}::uuid, ${actor.userId}::uuid, ${until})
      on conflict (conversation_id, participant_id) do update set typing_until = ${until}`);
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
