import { z } from 'zod';
import { extendItem, withdrawItem } from '@campusos/module-lost-found/write';
import { lostFoundGate, refusalResponse } from '@/lib/lost-found-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['withdraw', 'extend']),
});

/** Act on one's own item: withdraw an open item, or extend its expiry window. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await lostFoundGate(request, 'item-action', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const result =
    gate.data.action === 'extend'
      ? await extendItem(gate.actor, gate.tenant.slug, id, gate.settings)
      : await withdrawItem(gate.actor, gate.tenant.slug, id);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ changed: result.value.changed });
}
