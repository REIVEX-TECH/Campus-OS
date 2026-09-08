import { sql } from 'drizzle-orm';
import { withTenant, type TenantTransaction } from '@campusos/db';

/**
 * The notification seam. Any module tells a member that something happened through
 * this one call; the row is written by the `notifications_emit` definer (the app has
 * no INSERT on the table). Kinds are namespaced strings (`lostfound.claim_opened`,
 * `marketplace.sold`, `services.order_delivered`, `messages.request`, ...). The
 * payload carries whatever the inbox needs to render the line; the link is the
 * in-app path to open. Self-notifications (actor == recipient) are dropped by the
 * definer.
 */
export interface NotifyArgs {
  userId: string;
  kind: string;
  /** Display fields for the inbox line (e.g. { title, handle }). */
  payload?: Record<string, unknown>;
  /** In-app path to open, e.g. `/u/lgu/orders/<id>`. */
  link?: string;
  /** The person who acted, when recording them is appropriate. */
  actorId?: string;
}

/** Emit inside an existing write transaction (atomic with the action that caused it). */
export async function notifyInTx(tx: TenantTransaction, args: NotifyArgs): Promise<void> {
  await tx.execute(sql`
    select notifications_emit(
      ${args.userId}::uuid,
      ${args.kind},
      ${args.payload ? JSON.stringify(args.payload) : null}::jsonb,
      ${args.link ?? null},
      ${args.actorId ?? null}::uuid
    )`);
}

/** Emit in its own tenant-scoped transaction, for callers without one to hand. */
export async function notify(tenantId: string, args: NotifyArgs): Promise<void> {
  await withTenant(tenantId, (tx) => notifyInTx(tx, args));
}
