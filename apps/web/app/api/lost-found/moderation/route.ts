import { z } from 'zod';
import { getObjectStore } from '@campusos/media';
import { dismissReports, removeItem } from '@campusos/module-lost-found/moderation';
import { lostFoundGate, refusalResponse } from '@/lib/lost-found-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('remove'),
    itemId: z.string().uuid(),
    reason: z.string().trim().min(2).max(300),
  }),
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('dismiss'),
    targetType: z.enum(['lf_item', 'lf_claim']),
    targetId: z.string().uuid(),
  }),
]);

/** Moderator actions: remove an item (and resolve its reports), or dismiss reports. */
export async function POST(request: Request) {
  const gate = await lostFoundGate(request, 'moderation', 60, bodySchema);
  if (!gate.ok) return gate.response;
  const data = gate.data;
  if (data.action === 'remove') {
    const result = await removeItem(gate.actor, gate.tenant.slug, data.itemId, data.reason);
    if (!result.ok) return refusalResponse(result.error);
    // Photo rows are deleted with the removal; now remove the files from disk.
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
