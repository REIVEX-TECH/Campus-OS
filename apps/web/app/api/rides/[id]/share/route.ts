import { z } from 'zod';
import { createShareLink, revokeShareLinks } from '@campusos/module-rides/share';
import { ridesGate, refusalResponse } from '@/lib/rides-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['create', 'revoke']),
});

/** Create or revoke a share link for a ride. Driver or accepted passenger only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await ridesGate(request, 'share', 20, bodySchema);
  if (!gate.ok) return gate.response;
  if (gate.data.action === 'create') {
    const result = await createShareLink(gate.actor, gate.tenant.slug, id);
    if (!result.ok) return refusalResponse(result.error);
    return Response.json({ ok: true, token: result.value.token });
  }
  const result = await revokeShareLinks(gate.actor, gate.tenant.slug, id);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true, revoked: result.value.revoked });
}
