import { z } from 'zod';
import { acceptRequest, cancelSeatRequest, declineRequest } from '@campusos/module-rides/seats';
import { ridesGate, refusalResponse } from '@/lib/rides-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['accept', 'decline', 'cancel']),
});

/**
 * Act on a seat request: the driver accepts/declines, the passenger cancels. Which
 * party may do what is enforced in the module transaction (participant policy +
 * ownership), so this route only routes the verb.
 */
export async function POST(request: Request, { params }: { params: Promise<{ reqId: string }> }) {
  const { reqId } = await params;
  const gate = await ridesGate(request, 'seat-write', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const { action } = gate.data;
  const result =
    action === 'accept'
      ? await acceptRequest(gate.actor, gate.tenant.slug, reqId)
      : action === 'decline'
        ? await declineRequest(gate.actor, gate.tenant.slug, reqId)
        : await cancelSeatRequest(gate.actor, gate.tenant.slug, reqId);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json(result.value);
}
