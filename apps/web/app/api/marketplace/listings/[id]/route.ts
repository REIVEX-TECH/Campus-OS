import { z } from 'zod';
import { getObjectStore } from '@campusos/media';
import { deleteListing, extendListing, setListingStatus } from '@campusos/module-marketplace/write';
import { marketplaceGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['reserve', 'sell', 'relist', 'extend', 'delete']),
});

/** Seller actions on their own listing: reserve, sell, relist, extend, or delete. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await marketplaceGate(request, 'listing-action', 60, bodySchema);
  if (!gate.ok) return gate.response;
  const { action } = gate.data;

  if (action === 'delete') {
    const result = await deleteListing(gate.actor, gate.tenant.slug, id);
    if (!result.ok) return refusalResponse(result.error);
    if (result.value.photoKeys.length > 0) {
      const store = getObjectStore();
      await Promise.all(result.value.photoKeys.map((k) => store.delete(k).catch(() => undefined)));
    }
    return Response.json({ changed: result.value.changed });
  }

  if (action === 'extend') {
    const result = await extendListing(gate.actor, gate.tenant.slug, id, gate.settings);
    if (!result.ok) return refusalResponse(result.error);
    return Response.json({ changed: result.value.changed });
  }

  const next = action === 'reserve' ? 'reserved' : action === 'sell' ? 'sold' : 'active';
  const result = await setListingStatus(gate.actor, gate.tenant.slug, id, next);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ changed: result.value.changed });
}
