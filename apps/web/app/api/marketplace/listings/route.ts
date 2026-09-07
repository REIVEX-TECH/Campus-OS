import { z } from 'zod';
import { createListing } from '@campusos/module-marketplace/write';
import { marketplaceGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  title: z.string().max(200),
  description: z.string().max(8000).optional(),
  pricePaisa: z.number().int().min(0),
  priceKind: z.enum(['fixed', 'negotiable']).optional(),
  category: z.string().max(40),
  condition: z.string().max(20),
  meetupPref: z.string().max(200).optional(),
});

/** Create a goods listing. The module re-validates and enforces the seller gate. */
export async function POST(request: Request) {
  const gate = await marketplaceGate(request, 'create', 20, bodySchema);
  if (!gate.ok) return gate.response;
  const d = gate.data;
  const result = await createListing(
    gate.actor,
    gate.tenant.slug,
    {
      title: d.title,
      description: d.description,
      pricePaisa: d.pricePaisa,
      priceKind: d.priceKind ?? 'fixed',
      category: d.category,
      condition: d.condition as 'new' | 'like-new' | 'used' | 'for-parts',
      meetupPref: d.meetupPref,
    },
    gate.settings,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ id: result.value.id });
}
