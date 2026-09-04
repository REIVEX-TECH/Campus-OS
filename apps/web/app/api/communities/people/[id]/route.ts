import { z } from 'zod';
import { reportItem } from '@campusos/module-communities/moderation';
import { resolveUserReports } from '@campusos/module-communities/oversight';
import { communityGate, refusalResponse } from '@/lib/community-route';

/**
 * What is done about a person rather than about something they wrote.
 *
 * Reporting one, which any verified member may do once each, and closing the
 * reports about one, which needs `restrict-members`. Restricting or suspending
 * them is a separate, signed act on the identity routes: this queue records
 * that people complained, never that anything followed.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('report'),
    tenant: z.string(),
    reason: z.string(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('resolve'),
    tenant: z.string(),
    resolution: z.enum(['dismissed', 'acted']),
  }),
]);

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'person-action', 30, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const actor = { userId: gate.actor.userId };
  const tenant = gate.tenant.slug;
  const data = gate.data;

  if (data.action === 'report') {
    const result = await reportItem(
      actor,
      tenant,
      {
        itemType: 'user',
        itemId: id,
        // Validated by the module against its own reason list.
        reason: data.reason as Parameters<typeof reportItem>[2]['reason'],
        note: data.note,
      },
      gate.settings,
    );
    return result.ok ? Response.json(result.value) : refusalResponse(result.error);
  }

  const result = await resolveUserReports(actor, tenant, id, data.resolution);
  return result.ok ? Response.json(result.value) : refusalResponse(result.error);
}
