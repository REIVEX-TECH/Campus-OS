import { z } from 'zod';
import { reportTarget } from '@campusos/module-rides/safety';
import { ridesGate, refusalResponse } from '@/lib/rides-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  targetType: z.enum(['ride_post', 'user']),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(2).max(60),
  note: z.string().trim().max(1000).optional(),
});

/** Report a ride or a person. Idempotent per reporter per target. */
export async function POST(request: Request) {
  const gate = await ridesGate(request, 'report', 20, bodySchema);
  if (!gate.ok) return gate.response;
  const { targetType, targetId, reason, note } = gate.data;
  const result = await reportTarget(
    gate.actor,
    gate.tenant.slug,
    targetType,
    targetId,
    reason,
    gate.settings.reportThreshold,
    note,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true });
}
