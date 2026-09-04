import { z } from 'zod';
import { joinCommunity, leaveCommunity } from '@campusos/module-communities/communities';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Join or leave a community. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.enum(['join', 'leave']),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'membership', 30, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const actor = { userId: gate.actor.userId };
  const result =
    gate.data.action === 'join'
      ? await joinCommunity(actor, gate.tenant.slug, id)
      : await leaveCommunity(actor, gate.tenant.slug, id);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json(result.value);
}
