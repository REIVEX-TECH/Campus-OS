import { z } from 'zod';
import {
  acceptRequest,
  declineRequest,
  markRead,
  otherParticipant,
  sendMessage,
  setEphemerality,
  setTyping,
  thread,
  EPHEMERALITY,
} from '@campusos/module-messages/service';
import { blockUser, blockedBetween } from '@campusos/module-communities/blocks';
import { messagesGate, messagesReadGate, refusalResponse } from '@/lib/messages-route';

export const dynamic = 'force-dynamic';

/** One conversation's thread, for the client widget / two-pane. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await messagesReadGate(request);
  if (!gate.ok) return gate.response;
  const t = await thread(gate.actor, gate.tenant.slug, id);
  if (!t) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({
    id: t.id,
    otherUserId: t.otherUserId,
    otherHandle: t.otherHandle,
    otherAvatarSeed: t.otherAvatarSeed,
    otherLastReadAt: t.otherLastReadAt ? t.otherLastReadAt.toISOString() : null,
    ephemerality: t.ephemerality,
    status: t.status,
    isRequester: t.isRequester,
    canSend: t.canSend,
    otherTyping: t.otherTyping,
    messages: t.messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      deleted: m.deleted,
    })),
  });
}

const tenant = z.string().min(1).max(64);
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    tenant,
    action: z.literal('send'),
    body: z.string().trim().min(1),
    replyToId: z.string().uuid().optional(),
  }),
  z.object({ tenant, action: z.literal('read') }),
  z.object({ tenant, action: z.literal('typing'), on: z.boolean() }),
  z.object({ tenant, action: z.literal('ephemerality'), value: z.enum(EPHEMERALITY) }),
  z.object({ tenant, action: z.literal('accept') }),
  z.object({ tenant, action: z.literal('decline') }),
  z.object({ tenant, action: z.literal('decline_block') }),
]);

/** Act in one conversation: send, read, typing, set expiry, or accept/decline. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  // 120/min: a typing heartbeat fires up to every 2s and must not crowd out sends.
  const gate = await messagesGate(request, 'thread', 120, bodySchema);
  if (!gate.ok) return gate.response;
  const slug = gate.tenant.slug;

  if (gate.data.action === 'read') {
    const res = await markRead(gate.actor, slug, id, gate.settings.afterViewingGraceSeconds);
    if (!res.ok) return refusalResponse(res.error);
    return Response.json({ ok: true });
  }
  if (gate.data.action === 'typing') {
    const res = await setTyping(gate.actor, slug, id, gate.data.on);
    if (!res.ok) return refusalResponse(res.error);
    return Response.json({ ok: true });
  }
  if (gate.data.action === 'ephemerality') {
    const res = await setEphemerality(gate.actor, slug, id, gate.data.value);
    if (!res.ok) return refusalResponse(res.error);
    return Response.json({ ok: true });
  }
  if (gate.data.action === 'accept') {
    const res = await acceptRequest(gate.actor, slug, id);
    if (!res.ok) return refusalResponse(res.error);
    return Response.json({ ok: true });
  }
  if (gate.data.action === 'decline' || gate.data.action === 'decline_block') {
    const res = await declineRequest(gate.actor, slug, id);
    // A non-recipient cannot decline; anything else (already declined) still lets a
    // block through, since the two are one action for the recipient.
    if (!res.ok && res.error === 'not_recipient') return refusalResponse('not_allowed');
    if (!res.ok && res.error === 'not_found') return refusalResponse('not_found');
    if (gate.data.action === 'decline_block') {
      const other = await otherParticipant(gate.actor, slug, id);
      if (other) await blockUser(gate.actor, slug, other);
    }
    return Response.json({ ok: true });
  }
  // send: refuse if either party has blocked the other (checked at every send).
  const other = await otherParticipant(gate.actor, slug, id);
  if (other && (await blockedBetween(gate.actor, slug, other))) {
    return refusalResponse('blocked');
  }
  const res = await sendMessage(
    gate.actor,
    slug,
    id,
    { body: gate.data.body, replyToId: gate.data.replyToId },
    gate.settings,
  );
  if (!res.ok) return refusalResponse(res.error);
  return Response.json({ id: res.value.id });
}
