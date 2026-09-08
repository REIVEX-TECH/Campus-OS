import { sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { notifyInTx } from '@campusos/module-notifications/notify';
import { isVerifiedMember } from './access';

/** Tell the counterpart on an order that it moved, inside the same transaction. */
async function notifyOrderParty(
  tx: TenantTransaction,
  orderId: string,
  actorId: string,
): Promise<void> {
  const [order] = [
    ...(await tx.execute(sql`
      select buyer_id, seller_id, title from mkt_orders where id = ${orderId}::uuid limit 1`)),
  ] as { buyer_id: string; seller_id: string; title: string }[];
  if (!order) return;
  const recipient = order.buyer_id === actorId ? order.seller_id : order.buyer_id;
  await notifyInTx(tx, {
    userId: recipient,
    kind: 'services.order_update',
    payload: { title: order.title },
    link: `orders/${orderId}`,
    actorId,
  });
}
import { placeOrderInputSchema, reviewInputSchema, type PlaceOrderInput } from './orders-input';
import type { OrderTargetStatus } from './orders-input';

export type PlaceOrderRefusal = 'invalid' | 'not_verified' | 'not_found' | 'own_gig' | 'failed';

/**
 * Place an order against a package. The authoritative write is the mkt_place_order
 * definer, which re-derives the price/turnaround snapshot from the package itself
 * and writes the opening event; these TS pre-checks only turn the common refusals
 * into clean codes (the definer is the backstop and would raise on a race).
 */
export async function placeOrder(
  actor: { userId: string },
  tenantId: string,
  input: PlaceOrderInput,
): Promise<Result<{ id: string }, PlaceOrderRefusal>> {
  const parsed = placeOrderInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const data = parsed.data;
  try {
    return await withActorInTenant(actor.userId, tenantId, async (tx) => {
      if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
      const [gig] = [
        ...(await tx.execute(sql`
          select g.seller_id from mkt_gig_packages pk
          join mkt_gigs g on g.id = pk.gig_id
          where pk.id = ${data.packageId}::uuid and pk.gig_id = ${data.gigId}::uuid
            and g.tenant_id = ${tenantId} and g.status = 'active' and g.deleted_at is null
          limit 1`)),
      ] as { seller_id: string }[];
      if (!gig) return err('not_found');
      if (gig.seller_id === actor.userId) return err('own_gig');
      const [row] = [
        ...(await tx.execute(sql`
          select mkt_place_order(${tenantId}, ${data.gigId}::uuid, ${data.packageId}::uuid,
                                 ${data.paymentMode}, ${data.requirements ?? ''}) as id`)),
      ] as { id: string }[];
      // Tell the seller a request came in.
      await notifyOrderParty(tx, row!.id, actor.userId);
      return ok({ id: row!.id });
    });
  } catch {
    return err('failed');
  }
}

/** The outcome of a transition, as the definer reports it. */
export type TransitionOutcome = 'ok' | 'not_found' | 'not_party' | 'illegal';

/**
 * Move an order along one edge. The mkt_order_transition definer locks the row,
 * checks the actor is the order's buyer or seller for that edge, writes the status
 * and timestamps, and appends the event. Returns the definer's text outcome.
 */
export async function transitionOrder(
  actor: { userId: string },
  tenantId: string,
  orderId: string,
  to: OrderTargetStatus,
  note?: string,
): Promise<Result<{ outcome: TransitionOutcome }, 'failed'>> {
  try {
    return await withActorInTenant(actor.userId, tenantId, async (tx) => {
      const [row] = [
        ...(await tx.execute(sql`
          select mkt_order_transition(${tenantId}, ${orderId}::uuid, ${to}, ${note ?? ''})
            as outcome`)),
      ] as { outcome: TransitionOutcome }[];
      // On a real move, tell the other party.
      if (row!.outcome === 'ok') await notifyOrderParty(tx, orderId, actor.userId);
      return ok({ outcome: row!.outcome });
    });
  } catch {
    return err('failed');
  }
}

export type ReviewRefusal = 'invalid' | 'not_found' | 'not_buyer' | 'not_completed' | 'exists';

/**
 * Leave a review on a completed order. The reviewer must be the buyer, the order
 * must be completed, and there is one review per order (unique). The RLS
 * "insert_earned" restrictive policy is the backstop; these checks give clean
 * codes.
 */
export async function writeReview(
  actor: { userId: string },
  tenantId: string,
  orderId: string,
  input: { rating: number; body?: string },
): Promise<Result<{ id: string }, ReviewRefusal>> {
  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const data = parsed.data;
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [order] = [
      ...(await tx.execute(sql`
        select gig_id, seller_id, buyer_id, status from mkt_orders
        where id = ${orderId}::uuid and tenant_id = ${tenantId} limit 1`)),
    ] as { gig_id: string; seller_id: string; buyer_id: string; status: string }[];
    if (!order) return err('not_found');
    if (order.buyer_id !== actor.userId) return err('not_buyer');
    if (order.status !== 'completed') return err('not_completed');
    const [existing] = [
      ...(await tx.execute(sql`
        select 1 from mkt_reviews where order_id = ${orderId}::uuid limit 1`)),
    ];
    if (existing) return err('exists');
    const [row] = [
      ...(await tx.execute(sql`
        insert into mkt_reviews (tenant_id, order_id, gig_id, reviewer_id, seller_id, rating, body)
        values (${tenantId}, ${orderId}::uuid, ${order.gig_id}::uuid, ${actor.userId}::uuid,
                ${order.seller_id}::uuid, ${data.rating}, ${data.body ?? ''})
        on conflict (order_id) do nothing
        returning id`)),
    ] as { id: string }[];
    if (!row) return err('exists');
    return ok({ id: row.id });
  });
}
