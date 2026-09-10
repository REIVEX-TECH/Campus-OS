import { z } from 'zod';
import { rideInputSchema } from '@campusos/module-rides/input';
import { createRidePost } from '@campusos/module-rides/write';
import { ridesGate, refusalResponse } from '@/lib/rides-route';

export const dynamic = 'force-dynamic';

const bodySchema = rideInputSchema.and(z.object({ tenant: z.string().min(1).max(64) }));

/** Post a ride offer or request. Verified members only (checked in the module tx). */
export async function POST(request: Request) {
  const gate = await ridesGate(request, 'create', 20, bodySchema);
  if (!gate.ok) return gate.response;
  const { tenant: _tenant, ...input } = gate.data;
  const result = await createRidePost(gate.actor, gate.tenant.slug, input, gate.settings);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ id: result.value.id });
}
