import { z } from 'zod';
import { markRead } from '@campusos/module-communities/notifications';
import { communityGate } from '@/lib/community-route';

/** Mark some notifications, or all of them, as read. Own rows only, by RLS. */
export const dynamic = 'force-dynamic';

const schema = z.object({
  tenant: z.string().min(1).max(64),
  action: z.literal('read'),
  ids: z.union([z.literal('all'), z.array(z.string().uuid()).min(1).max(100)]),
});

export async function POST(request: Request): Promise<Response> {
  const gate = await communityGate(request, 'notifications', 60, schema);
  if (!gate.ok) return gate.response;
  const result = await markRead({ userId: gate.actor.userId }, gate.tenant.slug, gate.data.ids);
  return Response.json(result);
}
