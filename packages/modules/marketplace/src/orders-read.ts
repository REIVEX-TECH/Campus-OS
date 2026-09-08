import { sql } from 'drizzle-orm';
import { withActorInTenant, withTenant } from '@campusos/db';

/**
 * Reading orders. An order and its events are private to the two parties, enforced
 * by RLS (mkt_orders_party / mkt_order_events_party), so every read here runs in
 * the actor's context and returns only what they may see. Reviews are public and
 * read tenant-wide for the gig page.
 */

export interface OrderSummary {
  id: string;
  title: string;
  pricePaisa: number;
  status: string;
  paymentMode: string;
  buyerId: string;
  sellerId: string;
  createdAt: Date;
  dueAt: Date | null;
  counterpartHandle: string | null;
  counterpartAvatarSeed: string | null;
}

export interface OrderEvent {
  id: string;
  actorId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  kind: string;
  note: string | null;
  createdAt: Date;
}

export interface OrderDetail extends OrderSummary {
  gigId: string;
  packageId: string;
  deliveryDays: number;
  revisionsAllowed: number;
  revisionsUsed: number;
  requirements: string | null;
  buyerHandle: string | null;
  sellerHandle: string | null;
  events: OrderEvent[];
}

function toDate(value: string | Date | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/** A person's orders in one role, newest first. */
export async function listMyOrders(
  actor: { userId: string },
  tenantId: string,
  role: 'buyer' | 'seller',
): Promise<OrderSummary[]> {
  const mine = role === 'buyer' ? sql`o.buyer_id` : sql`o.seller_id`;
  const other = role === 'buyer' ? sql`o.seller_id` : sql`o.buyer_id`;
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select o.id, o.title, o.price_paisa, o.status, o.payment_mode, o.buyer_id, o.seller_id,
               o.created_at, o.due_at,
               p.handle as counterpart_handle, p.avatar_seed as counterpart_avatar_seed
        from mkt_orders o
        left join public_profiles p on p.user_id = ${other}
        where o.tenant_id = ${tenantId} and ${mine} = ${actor.userId}::uuid
        order by o.created_at desc, o.id desc
        limit 200`)),
    ] as Array<{
      id: string;
      title: string;
      price_paisa: string | number;
      status: string;
      payment_mode: string;
      buyer_id: string;
      seller_id: string;
      created_at: string | Date;
      due_at: string | Date | null;
      counterpart_handle: string | null;
      counterpart_avatar_seed: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      pricePaisa: Number(r.price_paisa),
      status: r.status,
      paymentMode: r.payment_mode,
      buyerId: r.buyer_id,
      sellerId: r.seller_id,
      createdAt: toDate(r.created_at)!,
      dueAt: toDate(r.due_at),
      counterpartHandle: r.counterpart_handle,
      counterpartAvatarSeed: r.counterpart_avatar_seed,
    }));
  });
}

/** One order in full, with its event log, for a party. Null if not theirs. */
export async function orderById(
  actor: { userId: string },
  tenantId: string,
  orderId: string,
): Promise<OrderDetail | null> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select o.id, o.title, o.price_paisa, o.status, o.payment_mode, o.buyer_id, o.seller_id,
               o.created_at, o.due_at, o.gig_id, o.package_id, o.delivery_days,
               o.revisions_allowed, o.revisions_used, o.requirements,
               bp.handle as buyer_handle, sp.handle as seller_handle,
               bp.avatar_seed as buyer_avatar_seed, sp.avatar_seed as seller_avatar_seed
        from mkt_orders o
        left join public_profiles bp on bp.user_id = o.buyer_id
        left join public_profiles sp on sp.user_id = o.seller_id
        where o.id = ${orderId}::uuid and o.tenant_id = ${tenantId}
        limit 1`)),
    ] as Array<Record<string, unknown>>;
    if (!row) return null;
    const isBuyer = row.buyer_id === actor.userId;
    const events = [
      ...(await tx.execute(sql`
        select id, actor_id, from_status, to_status, kind, note, created_at
        from mkt_order_events where order_id = ${orderId}::uuid
        order by created_at asc, id asc`)),
    ] as Array<{
      id: string;
      actor_id: string | null;
      from_status: string | null;
      to_status: string | null;
      kind: string;
      note: string | null;
      created_at: string | Date;
    }>;
    return {
      id: row.id as string,
      title: row.title as string,
      pricePaisa: Number(row.price_paisa),
      status: row.status as string,
      paymentMode: row.payment_mode as string,
      buyerId: row.buyer_id as string,
      sellerId: row.seller_id as string,
      createdAt: toDate(row.created_at as string)!,
      dueAt: toDate((row.due_at as string) ?? null),
      counterpartHandle: (isBuyer ? row.seller_handle : row.buyer_handle) as string | null,
      counterpartAvatarSeed: (isBuyer ? row.seller_avatar_seed : row.buyer_avatar_seed) as
        string | null,
      gigId: row.gig_id as string,
      packageId: row.package_id as string,
      deliveryDays: Number(row.delivery_days),
      revisionsAllowed: Number(row.revisions_allowed),
      revisionsUsed: Number(row.revisions_used),
      requirements: (row.requirements as string | null) ?? null,
      buyerHandle: (row.buyer_handle as string | null) ?? null,
      sellerHandle: (row.seller_handle as string | null) ?? null,
      events: events.map((e) => ({
        id: e.id,
        actorId: e.actor_id,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        kind: e.kind,
        note: e.note,
        createdAt: toDate(e.created_at)!,
      })),
    };
  });
}

export interface OrderFile {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  uploadedBy: string;
  createdAt: Date;
}

/** The delivery files on an order, for a party. Empty if not theirs (RLS). */
export async function orderFiles(
  actor: { userId: string },
  tenantId: string,
  orderId: string,
): Promise<OrderFile[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select id, filename, content_type, byte_size, uploaded_by, created_at
        from mkt_order_files where order_id = ${orderId}::uuid
        order by created_at asc, id asc`)),
    ] as Array<{
      id: string;
      filename: string;
      content_type: string;
      byte_size: number;
      uploaded_by: string;
      created_at: string | Date;
    }>;
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      contentType: r.content_type,
      byteSize: Number(r.byte_size),
      uploadedBy: r.uploaded_by,
      createdAt: toDate(r.created_at)!,
    }));
  });
}

/** One delivery file's storage key + display fields, for the download route. Null
 *  when the caller is not a party (RLS returns no row). */
export async function orderFileForDownload(
  actor: { userId: string },
  tenantId: string,
  orderId: string,
  fileId: string,
): Promise<{ storageKey: string; filename: string; contentType: string } | null> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select storage_key, filename, content_type from mkt_order_files
        where id = ${fileId}::uuid and order_id = ${orderId}::uuid limit 1`)),
    ] as { storage_key: string; filename: string; content_type: string }[];
    if (!row) return null;
    return { storageKey: row.storage_key, filename: row.filename, contentType: row.content_type };
  });
}

export interface GigReview {
  id: string;
  rating: number;
  body: string;
  reviewerHandle: string | null;
  createdAt: Date;
}

/** Public reviews for a gig, newest first, plus the rolling average. */
export async function reviewsForGig(
  tenantId: string,
  gigId: string,
): Promise<{ reviews: GigReview[]; count: number; average: number | null }> {
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select r.id, r.rating, r.body, r.created_at, p.handle as reviewer_handle
        from mkt_reviews r
        left join public_profiles p on p.user_id = r.reviewer_id
        where r.tenant_id = ${tenantId} and r.gig_id = ${gigId}::uuid
        order by r.created_at desc, r.id desc
        limit 100`)),
    ] as Array<{
      id: string;
      rating: number;
      body: string;
      created_at: string | Date;
      reviewer_handle: string | null;
    }>;
    const reviews = rows.map((r) => ({
      id: r.id,
      rating: Number(r.rating),
      body: r.body,
      reviewerHandle: r.reviewer_handle,
      createdAt: toDate(r.created_at)!,
    }));
    const count = reviews.length;
    const average = count === 0 ? null : reviews.reduce((s, r) => s + r.rating, 0) / count;
    return { reviews, count, average };
  });
}
