import { z } from 'zod';
import { getObjectStore } from '@campusos/media';
import { deleteGig, setGigStatus } from '@campusos/module-marketplace/services-write';
import { marketplaceServicesGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['pause', 'activate', 'delete']),
});

/** Seller actions on their own gig: pause, activate (un-pause), or delete. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await marketplaceServicesGate(request, 'gig-action', 60, bodySchema);
  if (!gate.ok) return gate.response;
  const { action } = gate.data;

  if (action === 'delete') {
    const result = await deleteGig(gate.actor, gate.tenant.slug, id);
    if (!result.ok) return refusalResponse(result.error);
    if (result.value.photoKeys.length > 0) {
      const store = getObjectStore();
      await Promise.all(result.value.photoKeys.map((k) => store.delete(k).catch(() => undefined)));
    }
    return Response.json({ changed: result.value.changed });
  }

  const next = action === 'pause' ? 'paused' : 'active';
  const result = await setGigStatus(gate.actor, gate.tenant.slug, id, next);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ changed: result.value.changed });
}
