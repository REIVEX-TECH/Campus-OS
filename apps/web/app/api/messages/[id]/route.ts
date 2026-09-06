import { z } from 'zod';
import { markRead, sendMessage } from '@campusos/module-messages/service';
import { messagesGate, refusalResponse } from '@/lib/messages-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('send'),
    body: z.string().trim().min(1),
    replyToId: z.string().uuid().optional(),
  }),
  z.object({ tenant: z.string().min(1).max(64), action: z.literal('read') }),
]);

/** Act in one conversation: send a message, or mark it read. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await messagesGate(request, 'thread', 60, bodySchema);
  if (!gate.ok) return gate.response;
  if (gate.data.action === 'read') {
    const res = await markRead(gate.actor, gate.tenant.slug, id);
    if (!res.ok) return refusalResponse(res.error);
    return Response.json({ ok: true });
  }
  const res = await sendMessage(
    gate.actor,
    gate.tenant.slug,
    id,
    { body: gate.data.body, replyToId: gate.data.replyToId },
    gate.settings,
  );
  if (!res.ok) return refusalResponse(res.error);
  return Response.json({ id: res.value.id });
}
