import { z } from 'zod';
import { placeOrder } from '@campusos/module-marketplace/orders-write';
import { marketplaceServicesGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  gigId: z.string().uuid(),
  packageId: z.string().uuid(),
  // Online is the money rail (Block 4); cash is pay-on-delivery. Buyers pick at order time.
  paymentMode: z.enum(['cash', 'online']).optional(),
  requirements: z.string().max(4000).optional(),
});

/** Place an order against a gig package. The module derives the price snapshot. */
export async function POST(request: Request) {
  const gate = await marketplaceServicesGate(request, 'order-create', 30, bodySchema);
  if (!gate.ok) return gate.response;
  const d = gate.data;
  const result = await placeOrder(gate.actor, gate.tenant.slug, {
    gigId: d.gigId,
    packageId: d.packageId,
    paymentMode: d.paymentMode,
    requirements: d.requirements,
  });
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ id: result.value.id });
}
