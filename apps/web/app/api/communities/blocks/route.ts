import { z } from 'zod';
import { blockUser, unblockUser } from '@campusos/module-communities/blocks';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** Block or unblock a person. The blocked person is told nothing. */
export const dynamic = 'force-dynamic';

const schema = z.object({
  tenant: z.string().min(1).max(64),
  userId: z.string().uuid(),
  on: z.boolean(),
});

export async function POST(request: Request): Promise<Response> {
  const gate = await communityGate(request, 'block', 30, schema);
  if (!gate.ok) return gate.response;
  const actor = { userId: gate.actor.userId };
  const result = gate.data.on
    ? await blockUser(actor, gate.tenant.slug, gate.data.userId)
    : await unblockUser(actor, gate.tenant.slug, gate.data.userId);
  return result.ok ? Response.json(result.value) : refusalResponse(result.error);
}
