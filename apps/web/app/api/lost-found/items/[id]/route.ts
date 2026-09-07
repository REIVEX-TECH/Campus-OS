import { z } from 'zod';
import { getObjectStore } from '@campusos/media';
import { extendItem, withdrawItem } from '@campusos/module-lost-found/write';
import { lostFoundGate, refusalResponse } from '@/lib/lost-found-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['withdraw', 'extend']),
});

/** Best-effort removal of an item's photo files after its rows are already gone. A
 *  missing object is not an error; a failure here only leaves a reclaimable blob. */
async function deletePhotoFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const store = getObjectStore();
  await Promise.all(keys.map((k) => store.delete(k).catch(() => undefined)));
}

/** Act on one's own item: withdraw an open item, or extend its expiry window. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await lostFoundGate(request, 'item-action', 30, bodySchema);
  if (!gate.ok) return gate.response;

  if (gate.data.action === 'extend') {
    const result = await extendItem(gate.actor, gate.tenant.slug, id, gate.settings);
    if (!result.ok) return refusalResponse(result.error);
    return Response.json({ changed: result.value.changed });
  }

  const result = await withdrawItem(gate.actor, gate.tenant.slug, id);
  if (!result.ok) return refusalResponse(result.error);
  // The photo rows are deleted in the same transaction as the withdraw; now remove
  // the files so a withdrawn item leaves nothing on disk.
  await deletePhotoFiles(result.value.photoKeys);
  return Response.json({ changed: result.value.changed });
}
