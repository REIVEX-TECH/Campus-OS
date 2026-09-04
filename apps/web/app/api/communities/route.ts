import { z } from 'zod';
import { createCommunity } from '@campusos/module-communities/communities';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Create a community. The module decides verification, permission and limits. */
export const dynamic = 'force-dynamic';

const schema = z.object({
  tenant: z.string().min(1).max(64),
  name: z.string(),
  description: z.string().optional(),
  allowAnonymous: z.boolean().optional(),
  allowedKinds: z.array(z.enum(['text', 'link', 'poll'])).optional(),
  visibility: z.enum(['public', 'restricted']).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const gate = await communityGate(request, 'create', 5, schema);
  if (!gate.ok) return gate.response;
  const { tenant: _tenant, ...input } = gate.data;
  const result = await createCommunity(
    { userId: gate.actor.userId },
    gate.tenant.slug,
    input,
    gate.settings,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ id: result.value.id, slug: result.value.slug });
}
