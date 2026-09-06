import { z } from 'zod';
import {
  confirmClaim,
  rejectClaim,
  sendClaimMessage,
  withdrawClaim,
} from '@campusos/module-lost-found/claims';
import { lostFoundGate, refusalResponse } from '@/lib/lost-found-route';

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('message'),
    body: z.string().trim().min(1).max(2000),
  }),
  z.object({ tenant: z.string().min(1).max(64), action: z.literal('confirm') }),
  z.object({ tenant: z.string().min(1).max(64), action: z.literal('reject') }),
  z.object({ tenant: z.string().min(1).max(64), action: z.literal('withdraw') }),
]);

/** Act on a claim: send a message, confirm, reject, or withdraw. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await lostFoundGate(request, 'claim-act', 60, bodySchema);
  if (!gate.ok) return gate.response;
  const { actor } = gate;
  const slug = gate.tenant.slug;
  const data = gate.data;

  const result =
    data.action === 'message'
      ? await sendClaimMessage(actor, slug, id, data.body)
      : data.action === 'confirm'
        ? await confirmClaim(actor, slug, id)
        : data.action === 'reject'
          ? await rejectClaim(actor, slug, id)
          : await withdrawClaim(actor, slug, id);
  if (!result.ok) return refusalResponse(result.error);
  return Response.json({ ok: true });
}
