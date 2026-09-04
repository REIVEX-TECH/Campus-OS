import { z } from 'zod';
import { createComment } from '@campusos/module-communities/comments';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Comment on a post, or reply to a comment on it. The module decides membership, depth and limits. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  tenant: z.string().min(1).max(64),
  parentId: z.string().uuid().nullable().optional(),
  body: z.string(),
  isAnonymous: z.boolean().optional(),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'comment-create', 30, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const result = await createComment(
    { userId: gate.actor.userId },
    gate.tenant.slug,
    id,
    gate.data.parentId ?? null,
    { body: gate.data.body, isAnonymous: gate.data.isAnonymous },
    gate.settings,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json(result.value);
}
