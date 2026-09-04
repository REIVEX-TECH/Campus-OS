import { z } from 'zod';
import { createPost } from '@campusos/module-communities/posts';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Create a post in a community. The module decides membership, kind, anonymity and limits. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  tenant: z.string().min(1).max(64),
  kind: z.enum(['text', 'link', 'poll']),
  title: z.string(),
  body: z.string().optional(),
  url: z.string().optional(),
  isAnonymous: z.boolean().optional(),
  spoiler: z.boolean().optional(),
  poll: z
    .object({ options: z.array(z.string()), closesInHours: z.number().int().optional() })
    .optional(),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'post-create', 10, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const { tenant: _tenant, ...input } = gate.data;
  const result = await createPost(
    { userId: gate.actor.userId },
    gate.tenant.slug,
    id,
    input,
    gate.settings,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json(result.value);
}
