import { z } from 'zod';
import { submitRating } from '@campusos/module-rides/ratings';
import { ridesGate, refusalResponse } from '@/lib/rides-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  ratee: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  direction: z.enum(['of_driver', 'of_passenger']),
  comment: z.string().trim().max(2000).optional(),
});

/** Rate the other party of a completed ride. Eligibility is re-checked in the definer. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await ridesGate(request, 'rate', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const { ratee, stars, direction, comment } = gate.data;
  const result = await submitRating(gate.actor, gate.tenant.slug, {
    rideId: id,
    ratee,
    stars,
    direction,
    comment,
  });
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true, created: result.value.created });
}
