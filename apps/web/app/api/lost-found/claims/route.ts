import { z } from 'zod';
import { openClaim } from '@campusos/module-lost-found/claims';
import { lostFoundGate, refusalResponse } from '@/lib/lost-found-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  itemId: z.string().uuid(),
  message: z.string().trim().min(3).max(2000),
});

/** Open a claim on an item. Verified members only (checked in the module). */
export async function POST(request: Request) {
  const gate = await lostFoundGate(request, 'claim', 20, bodySchema);
  if (!gate.ok) return gate.response;
  const result = await openClaim(gate.actor, gate.tenant.slug, gate.data.itemId, gate.data.message);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ id: result.value.id });
}
