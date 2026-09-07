import { listInbox, listRequests } from '@campusos/module-messages/service';
import { messagesReadGate } from '@/lib/messages-route';

export const dynamic = 'force-dynamic';

/** The actor's inbox and inbound requests, for the client widget / two-pane list. */
export async function GET(request: Request): Promise<Response> {
  const gate = await messagesReadGate(request);
  if (!gate.ok) return gate.response;
  const slug = gate.tenant.slug;
  const [conversations, requests] = await Promise.all([
    listInbox(gate.actor.userId, slug),
    listRequests(gate.actor.userId, slug),
  ]);
  return Response.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      otherUserId: c.otherUserId,
      otherHandle: c.otherHandle,
      otherAvatarSeed: c.otherAvatarSeed,
      lastMessagePreview: c.lastMessagePreview,
      unread: c.unread,
      outbound: c.outbound,
      lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      fromUserId: r.fromUserId,
      fromHandle: r.fromHandle,
      fromAvatarSeed: r.fromAvatarSeed,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
