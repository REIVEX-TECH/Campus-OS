import { z } from 'zod';
import { requestSeat } from '@campusos/module-rides/seats';
import { ridesGate, refusalResponse } from '@/lib/rides-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ tenant: z.string().min(1).max(64) });

/** A passenger requests a seat on an offer. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await ridesGate(request, 'seat-request', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const result = await requestSeat(gate.actor, gate.tenant.slug, id);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json(result.value);
}
