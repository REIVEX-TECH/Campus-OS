import { z } from 'zod';
import { reportTarget } from '@campusos/module-marketplace/moderation';
import { marketplaceGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  targetType: z.literal('mkt_listing'),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(2).max(60),
  note: z.string().trim().max(1000).optional(),
});

/** Report a listing to moderators. Idempotent per reporter per listing. */
export async function POST(request: Request) {
  const gate = await marketplaceGate(request, 'report', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const d = gate.data;
  const result = await reportTarget(
    gate.actor,
    gate.tenant.slug,
    d.targetType,
    d.targetId,
    d.reason,
    d.note,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true });
}
