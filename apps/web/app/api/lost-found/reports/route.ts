import { z } from 'zod';
import { reportTarget } from '@campusos/module-lost-found/moderation';
import { lostFoundGate, refusalResponse } from '@/lib/lost-found-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  targetType: z.enum(['lf_item', 'lf_claim']),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(2).max(60),
  note: z.string().trim().max(1000).optional(),
});

/** Report an item or a claim. Any signed-in member; idempotent per target. */
export async function POST(request: Request) {
  const gate = await lostFoundGate(request, 'report', 20, bodySchema);
  if (!gate.ok) return gate.response;
  const { targetType, targetId, reason, note } = gate.data;
  const result = await reportTarget(
    gate.actor,
    gate.tenant.slug,
    targetType,
    targetId,
    reason,
    note,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true });
}
