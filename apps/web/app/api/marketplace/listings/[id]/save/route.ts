import { z } from 'zod';
import { saveListing, unsaveListing } from '@campusos/module-marketplace/write';
import { marketplaceGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['save', 'unsave']),
});

/** Save or unsave a listing for the signed-in member (their private bookmark). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await marketplaceGate(request, 'save', 120, bodySchema);
  if (!gate.ok) return gate.response;
  const result =
    gate.data.action === 'save'
      ? await saveListing(gate.actor, gate.tenant.slug, id)
      : await unsaveListing(gate.actor, gate.tenant.slug, id);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true });
}
