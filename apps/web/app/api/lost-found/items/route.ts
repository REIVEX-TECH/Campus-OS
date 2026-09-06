import { z } from 'zod';
import { itemInputSchema } from '@campusos/module-lost-found/input';
import { createItem } from '@campusos/module-lost-found/write';
import { lostFoundGate, refusalResponse } from '@/lib/lost-found-route';

export const dynamic = 'force-dynamic';

const bodySchema = itemInputSchema.extend({ tenant: z.string().min(1).max(64) });

/** Report an item. Verified members only (checked in the module transaction). */
export async function POST(request: Request) {
  const gate = await lostFoundGate(request, 'create', 20, bodySchema);
  if (!gate.ok) return gate.response;
  const { tenant: _tenant, ...input } = gate.data;
  const result = await createItem(gate.actor, gate.tenant.slug, input, gate.settings);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ id: result.value.id });
}
