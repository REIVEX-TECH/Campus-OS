import { z } from 'zod';
import { getObjectStore } from '@campusos/media';
import { dismissReports, removeListing } from '@campusos/module-marketplace/moderation';
import { marketplaceGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('remove'),
    listingId: z.string().uuid(),
    reason: z.string().trim().min(2).max(300),
  }),
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('dismiss'),
    targetType: z.literal('mkt_listing'),
    targetId: z.string().uuid(),
  }),
]);

/** Moderator actions: remove a listing (and resolve its reports), or dismiss them. */
export async function POST(request: Request) {
  const gate = await marketplaceGate(request, 'moderation', 60, bodySchema);
  if (!gate.ok) return gate.response;
  const data = gate.data;
  if (data.action === 'remove') {
    const result = await removeListing(gate.actor, gate.tenant.slug, data.listingId, data.reason);
    if (!result.ok) return refusalResponse(result.error);
    if (result.value.photoKeys.length > 0) {
      const store = getObjectStore();
      await Promise.all(result.value.photoKeys.map((k) => store.delete(k).catch(() => undefined)));
    }
    return Response.json({ ok: true });
  }
  const result = await dismissReports(gate.actor, gate.tenant.slug, data.targetType, data.targetId);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true });
}
