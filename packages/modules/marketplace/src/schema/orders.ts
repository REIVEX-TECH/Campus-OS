import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';
import { marketplaceGigPackages, marketplaceGigs } from './services';

/**
 * Orders on a gig, their append-only event log, and reviews. An order snapshots
 * the gig + package it was placed against (price, turnaround, revisions), so a
 * later edit to the gig never rewrites what was agreed. Status moves only through
 * the mkt_order_transition SECURITY DEFINER (drizzle/0004), which locks the row,
 * checks the actor is the order's buyer or seller for the edge, and appends to the
 * event log in the same statement. The application role cannot write status,
 * timestamps, or events directly.
 *
 * Money does not move here. Prices are the agreed amount in integer paisa; the
 * ledger, fees, and payouts are the money module's concern (a later block).
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const marketplaceOrders = pgTable(
  'mkt_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    gigId: uuid('gig_id')
      .notNull()
      .references(() => marketplaceGigs.id, { onDelete: 'restrict' }),
    packageId: uuid('package_id')
      .notNull()
      .references(() => marketplaceGigPackages.id, { onDelete: 'restrict' }),
    buyerId: uuid('buyer_id').notNull(),
    sellerId: uuid('seller_id').notNull(),
    /** Snapshot of gig + package at order time (gig edits never rewrite an order). */
    title: text('title').notNull(),
    pricePaisa: bigint('price_paisa', { mode: 'number' }).notNull(),
    deliveryDays: integer('delivery_days').notNull(),
    revisionsAllowed: integer('revisions_allowed').notNull().default(0),
    revisionsUsed: integer('revisions_used').notNull().default(0),
    /** 'cash' (pay on delivery, no rail) | 'online' (the money module, later). */
    paymentMode: text('payment_mode').notNull().default('cash'),
    /**
     * requested | awaiting_payment | paid | in_progress | delivered | completed |
     * cancelled | disputed. Moves only through mkt_order_transition.
     */
    status: text('status').notNull().default('requested'),
    requirements: text('requirements'),
    acceptedAt: tz('accepted_at'),
    paidAt: tz('paid_at'),
    startedAt: tz('started_at'),
    deliveredAt: tz('delivered_at'),
    completedAt: tz('completed_at'),
    cancelledAt: tz('cancelled_at'),
    disputedAt: tz('disputed_at'),
    dueAt: tz('due_at'),
    cancelReason: text('cancel_reason'),
    createdAt,
  },
  (t) => [
    index('mkt_orders_buyer_idx').on(t.tenantId, t.buyerId, t.createdAt),
    index('mkt_orders_seller_idx').on(t.tenantId, t.sellerId, t.createdAt),
    index('mkt_orders_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('mkt_orders_autocomplete_idx').on(t.status, t.deliveredAt),
  ],
);

export const marketplaceOrderEvents = pgTable(
  'mkt_order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => marketplaceOrders.id, { onDelete: 'cascade' }),
    /** Who triggered it; null for a system action (auto-complete). */
    actorId: uuid('actor_id'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    /** 'transition' | 'delivery' | 'revision' | 'note'. */
    kind: text('kind').notNull().default('transition'),
    note: text('note'),
    createdAt,
  },
  (t) => [index('mkt_order_events_order_idx').on(t.orderId, t.createdAt)],
);

export const marketplaceReviews = pgTable(
  'mkt_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => marketplaceOrders.id, { onDelete: 'cascade' }),
    gigId: uuid('gig_id')
      .notNull()
      .references(() => marketplaceGigs.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id').notNull(),
    sellerId: uuid('seller_id').notNull(),
    /** 1..5. */
    rating: integer('rating').notNull(),
    body: text('body').notNull().default(''),
    createdAt,
  },
  (t) => [
    uniqueIndex('mkt_reviews_order_uq').on(t.orderId),
    index('mkt_reviews_gig_idx').on(t.gigId, t.createdAt),
    index('mkt_reviews_seller_idx').on(t.tenantId, t.sellerId, t.createdAt),
  ],
);

export type MarketplaceOrder = typeof marketplaceOrders.$inferSelect;
export type MarketplaceOrderEvent = typeof marketplaceOrderEvents.$inferSelect;
export type MarketplaceReview = typeof marketplaceReviews.$inferSelect;
