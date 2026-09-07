import { z } from 'zod';
import { startConversation } from '@campusos/module-messages/service';
import { blockedBetween } from '@campusos/module-communities/blocks';
import { messagesGate, refusalResponse } from '@/lib/messages-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ tenant: z.string().min(1).max(64), userId: z.string().uuid() });

/** Open (or reuse) a 1:1 conversation with another member. */
export async function POST(request: Request): Promise<Response> {
  const gate = await messagesGate(request, 'start', 20, bodySchema);
  if (!gate.ok) return gate.response;
  // Honor a block in EITHER direction: neither of a blocked pair may open a request.
  if (await blockedBetween(gate.actor, gate.tenant.slug, gate.data.userId)) {
    return refusalResponse('blocked');
  }
  const result = await startConversation(
    gate.actor,
    gate.tenant.slug,
    gate.data.userId,
    gate.settings,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ id: result.value.id });
}
