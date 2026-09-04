import { z } from 'zod';
import { setFlairs } from '@campusos/module-communities/flairs';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Replace a community's post flairs. Owners, or the university's administrators. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  tenant: z.string().min(1).max(64),
  flairs: z
    .array(z.object({ id: z.string().uuid().optional(), name: z.string(), color: z.string() }))
    .max(20),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'flairs', 20, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const result = await setFlairs(
    { userId: gate.actor.userId },
    gate.tenant.slug,
    id,
    gate.data.flairs,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ count: result.value.length });
}
