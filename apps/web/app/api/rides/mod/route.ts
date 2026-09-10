import { z } from 'zod';
import { removeRide, dismissReports } from '@campusos/module-rides/safety';
import { ridesGate, refusalResponse } from '@/lib/rides-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['remove', 'dismiss']),
  targetType: z.enum(['ride_post', 'user']),
  targetId: z.string().uuid(),
  reason: z.string().trim().max(300).optional(),
});

/** Moderator actions on the report queue: remove a ride, or dismiss a target's reports. */
export async function POST(request: Request) {
  const gate = await ridesGate(request, 'mod', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const { action, targetType, targetId, reason } = gate.data;
  if (action === 'remove') {
    // Only a ride can be removed; a person is handled by blocking/dismissal, not removal.
    if (targetType !== 'ride_post') return refusalResponse('invalid');
    const result = await removeRide(gate.actor, gate.tenant.slug, targetId, reason ?? '');
    if (!result.ok) return refusalResponse(result.error);
    return Response.json({ ok: true });
  }
  const result = await dismissReports(gate.actor, gate.tenant.slug, targetType, targetId);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true });
}
