import { z } from 'zod';
import { withdrawItem } from '@campusos/module-lost-found/write';
import { lostFoundGate, refusalResponse } from '@/lib/lost-found-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ tenant: z.string().min(1).max(64), action: z.literal('withdraw') });

/** Act on one's own item. Today: withdraw an open item. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await lostFoundGate(request, 'withdraw', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const result = await withdrawItem(gate.actor, gate.tenant.slug, id);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ changed: result.value.changed });
}
