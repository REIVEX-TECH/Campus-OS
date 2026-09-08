import { z } from 'zod';
import { writeReview } from '@campusos/module-marketplace/orders-write';
import { marketplaceServicesGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  rating: z.number().int().min(1).max(5),
  body: z.string().max(2000).optional(),
});

/** The buyer reviews a completed order (one per order). The module enforces the rest. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await marketplaceServicesGate(request, 'order-review', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const result = await writeReview(gate.actor, gate.tenant.slug, id, {
    rating: gate.data.rating,
    body: gate.data.body,
  });
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true, id: result.value.id });
}
