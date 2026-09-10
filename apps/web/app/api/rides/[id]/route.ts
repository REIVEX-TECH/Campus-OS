import { z } from 'zod';
import { cancelRide, editRide } from '@campusos/module-rides/write';
import { ridesGate, refusalResponse } from '@/lib/rides-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['edit', 'cancel']),
  edit: z
    .object({
      originText: z.string().trim().min(2).max(120).optional(),
      destText: z.string().trim().min(2).max(120).optional(),
      departAt: z.string().datetime({ offset: true }).optional(),
      notes: z.string().max(2000).optional(),
      womenOnly: z.boolean().optional(),
    })
    .optional(),
});

/** Edit or cancel one's own ride. Ownership + state are checked in the module tx. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await ridesGate(request, 'ride-write', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const { action, edit } = gate.data;
  const result =
    action === 'cancel'
      ? await cancelRide(gate.actor, gate.tenant.slug, id)
      : await editRide(gate.actor, gate.tenant.slug, id, edit ?? {});
  if (!result.ok) return refusalResponse(result.error);
  return Response.json(result.value);
}
