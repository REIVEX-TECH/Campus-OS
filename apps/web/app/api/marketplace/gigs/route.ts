import { z } from 'zod';
import { createGig } from '@campusos/module-marketplace/services-write';
import { marketplaceServicesGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const packageSchema = z.object({
  tier: z.enum(['basic', 'standard', 'premium']),
  title: z.string().max(200),
  description: z.string().max(4000).optional(),
  pricePaisa: z.number().int().min(1),
  deliveryDays: z.number().int().min(1),
  revisions: z.number().int().min(0),
});

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  title: z.string().max(200),
  description: z.string().max(8000).optional(),
  category: z.string().max(40),
  packages: z.array(packageSchema).min(1).max(3),
});

/** Create a gig with its packages. The module re-validates and enforces the gate. */
export async function POST(request: Request) {
  const gate = await marketplaceServicesGate(request, 'gig-create', 20, bodySchema);
  if (!gate.ok) return gate.response;
  const d = gate.data;
  const result = await createGig(
    gate.actor,
    gate.tenant.slug,
    {
      title: d.title,
      description: d.description,
      category: d.category,
      packages: d.packages,
    },
    gate.settings,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ id: result.value.id });
}
