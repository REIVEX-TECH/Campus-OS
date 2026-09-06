import { z } from 'zod';
import { deleteForEveryone, editMessage } from '@campusos/module-messages/service';
import { reportMessage, REPORT_REASONS } from '@campusos/module-messages/moderation';
import { messagesGate, refusalResponse } from '@/lib/messages-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('edit'),
    body: z.string().trim().min(1),
  }),
  z.object({ tenant: z.string().min(1).max(64), action: z.literal('delete') }),
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('report'),
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  }),
]);

/** Act on one message: edit it, delete it for everyone, or report it. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await params;
  if (!z.string().uuid().safeParse(messageId).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await messagesGate(request, 'message', 60, bodySchema);
  if (!gate.ok) return gate.response;
  if (gate.data.action === 'edit') {
    const res = await editMessage(
      gate.actor,
      gate.tenant.slug,
      messageId,
      { body: gate.data.body },
      gate.settings,
    );
    if (!res.ok) return refusalResponse(res.error);
    return Response.json({ ok: true });
  }
  if (gate.data.action === 'delete') {
    const res = await deleteForEveryone(gate.actor, gate.tenant.slug, messageId, gate.settings);
    if (!res.ok) return refusalResponse(res.error);
    return Response.json({ ok: true });
  }
  const res = await reportMessage(
    gate.actor,
    gate.tenant.slug,
    messageId,
    gate.data.reason,
    gate.data.note ?? null,
  );
  if (!res.ok) return refusalResponse(res.error);
  return Response.json({ reported: res.value.reported });
}
