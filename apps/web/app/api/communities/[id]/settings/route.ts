import { z } from 'zod';
import { updateCommunitySettings } from '@campusos/module-communities/settings';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Replace a community's settings. Owners, or the university's administrators. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  tenant: z.string().min(1).max(64),
  name: z.string(),
  description: z.string(),
  allowAnonymous: z.boolean(),
  visibility: z.enum(['public', 'restricted']),
  allowedKinds: z.array(z.enum(['text', 'link'])),
  modLogPublic: z.boolean(),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'settings', 20, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const { tenant: _tenant, ...input } = gate.data;
  const result = await updateCommunitySettings(
    { userId: gate.actor.userId },
    gate.tenant.slug,
    id,
    input,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ slug: result.value.slug });
}
