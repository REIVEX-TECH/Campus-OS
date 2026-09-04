import { z } from 'zod';
import { acceptRules } from '@campusos/module-communities/rules';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** A member says they have read a community's rules. Recorded once, on their membership. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ tenant: z.string().min(1).max(64) });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'rules-accept', 20, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const result = await acceptRules({ userId: gate.actor.userId }, gate.tenant.slug, id);
  return result.ok ? Response.json(result.value) : refusalResponse(result.error);
}
