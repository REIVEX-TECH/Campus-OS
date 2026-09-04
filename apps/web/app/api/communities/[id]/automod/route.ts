import { z } from 'zod';
import { setAutomodRules } from '@campusos/module-communities/automod';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Replace a community's automod rules. Owners, or the university's administrators. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  tenant: z.string().min(1).max(64),
  rules: z
    .array(
      z.object({
        kind: z.enum(['keyword', 'domain']),
        pattern: z.string(),
        action: z.enum(['queue', 'remove']),
      }),
    )
    .max(50),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'automod', 20, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const result = await setAutomodRules(
    { userId: gate.actor.userId },
    gate.tenant.slug,
    id,
    gate.data.rules,
  );
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ count: result.value.length });
}
