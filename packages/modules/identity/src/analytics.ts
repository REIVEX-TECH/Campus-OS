import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { canInTransaction } from './rbac';

/**
 * Activity for a tenant's dashboard: timing only, and aggregated.
 *
 * Nothing here records or returns where anyone was; the schema has no column
 * for it. What is read is when: sessions issued (sign ins) and each member's
 * last seen mark, folded into counts. Those two live on `sessions` and `users`,
 * which are visible only to their owner, so the reads go through SECURITY
 * DEFINER functions that answer for one tenant and return nothing but counts.
 * The application checks `view-analytics` inside the transaction before asking.
 */

export interface ActivityTotals {
  members: number;
  activeDay: number;
  activeWeek: number;
  activeMonth: number;
}

export interface ActivityDay {
  /** YYYY-MM-DD in the tenant's timezone. */
  day: string;
  signIns: number;
  lastActive: number;
}

export interface RoleCount {
  key: string;
  name: string;
  isSystem: boolean;
  members: number;
}

export interface QueueStats {
  pending: number;
  oldestPendingAt: Date | null;
}

export interface TenantActivity {
  totals: ActivityTotals;
  days: ActivityDay[];
  byRole: RoleCount[];
  queue: QueueStats;
}

export const ACTIVITY_DAYS_MAX = 90;

export async function tenantActivity(
  actor: { userId: string },
  tenantId: string,
  options: { days: number; timezone: string },
): Promise<Result<TenantActivity, 'not_allowed'>> {
  const days = Math.min(Math.max(1, Math.trunc(options.days)), ACTIVITY_DAYS_MAX);
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await canInTransaction(tx, actor.userId, tenantId, 'view-analytics'))) {
      return err('not_allowed');
    }

    const [totals] = [
      ...(await tx.execute(sql`
        select members, active_day, active_week, active_month
        from auth_tenant_activity_totals(${tenantId})`)),
    ] as { members: number; active_day: number; active_week: number; active_month: number }[];

    const dayRows = [
      ...(await tx.execute(sql`
        select to_char(day, 'YYYY-MM-DD') as day, sign_ins, last_active
        from auth_tenant_activity_days(${tenantId}, ${days}::int, ${options.timezone})`)),
    ] as { day: string; sign_ins: number; last_active: number }[];

    const roleRows = [
      ...(await tx.execute(sql`
        select r.key, r.name, r.is_system, count(m.id)::int as members
        from roles r
        left join membership_roles mr on mr.role_id = r.id
        left join tenant_memberships m on m.id = mr.membership_id and m.status = 'active'
        where r.tenant_id = ${tenantId}
        group by r.id, r.key, r.name, r.is_system
        order by members desc, r.name asc`)),
    ] as { key: string; name: string; is_system: boolean; members: number }[];

    const [queue] = [
      ...(await tx.execute(sql`
        select count(*)::int as pending, min(created_at) as oldest
        from verification_requests
        where tenant_id = ${tenantId} and status = 'pending'`)),
    ] as { pending: number; oldest: string | Date | null }[];

    return ok({
      totals: {
        members: totals?.members ?? 0,
        activeDay: totals?.active_day ?? 0,
        activeWeek: totals?.active_week ?? 0,
        activeMonth: totals?.active_month ?? 0,
      },
      days: dayRows.map((r) => ({ day: r.day, signIns: r.sign_ins, lastActive: r.last_active })),
      byRole: roleRows.map((r) => ({
        key: r.key,
        name: r.name,
        isSystem: r.is_system,
        members: r.members,
      })),
      queue: {
        pending: queue?.pending ?? 0,
        oldestPendingAt: queue?.oldest ? new Date(queue.oldest) : null,
      },
    });
  });
}
