import { z } from 'zod';
import { setCommunityRole } from '@campusos/module-communities/communities';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Give a member a community role, or take one away. Owners, or the university's administrators. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  tenant: z.string().min(1).max(64),
  userId: z.string().uuid(),
  roleKey: z.enum(['community_member', 'community_moderator', 'community_owner']),
  action: z.enum(['grant', 'revoke']),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'roles', 30, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const result = await setCommunityRole(
    { userId: gate.actor.userId },
    gate.tenant.slug,
    id,
    gate.data.userId,
    gate.data.roleKey,
    gate.data.action,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json(result.value);
}
