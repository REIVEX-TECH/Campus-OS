import { z } from 'zod';
import { transitionOrder } from '@campusos/module-marketplace/orders-write';
import { marketplaceServicesGate, refusalResponse } from '@/lib/marketplace-route';

export const dynamic = 'force-dynamic';

/**
 * The transitions the UI may drive, deliberately EXCLUDING `paid`: moving an order
 * to paid is the money line and belongs to the finance flow (Block 4, payment
 * confirmation), never a buyer clicking a button. Everything up to and around it is
 * here: accept (to awaiting_payment or, for cash, in_progress), deliver, complete,
 * request a revision (also `in_progress`), cancel, and open a dispute.
 */
const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  to: z.enum([
    'awaiting_payment',
    'in_progress',
    'delivered',
    'completed',
    'cancelled',
    'disputed',
  ]),
  note: z.string().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const gate = await marketplaceServicesGate(request, 'order-action', 60, bodySchema);
  if (!gate.ok) return gate.response;
  const { to, note } = gate.data;
  const result = await transitionOrder(gate.actor, gate.tenant.slug, id, to, note);
  if (!result.ok) return refusalResponse(result.error);
  const { outcome } = result.value;
  // A refused edge is a 409, not a 500: it is a legitimate "not allowed from here".
  if (outcome !== 'ok') {
    const status = outcome === 'not_party' ? 403 : outcome === 'not_found' ? 404 : 409;
    return Response.json({ error: outcome }, { status });
  }
  return Response.json({ ok: true });
}
