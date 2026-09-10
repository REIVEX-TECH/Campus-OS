import { sql } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * The rides lifecycle sweep. A maintenance run (no actor): it completes rides past
 * `completeAfterHours` after departure that carried an accepted seat, expires the
 * rest, and spawns the next occurrence of each recurring offer that just ended.
 *
 * The work is done inside the `auth_rides_sweep` definer, which reads seat requests
 * and the tenant timezone as the owner (the app cannot see either across the
 * participant RLS / without an actor). This wrapper only invokes it and reports the
 * counts, so it is safe to run from a scheduler.
 */
export interface SweepResult {
  completed: number;
  expired: number;
  spawned: number;
}

export async function sweepRides(
  tenantId: string,
  opts: { completeAfterHours?: number } = {},
): Promise<SweepResult> {
  const hours = opts.completeAfterHours ?? 2;
  return withTenant(tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select completed, expired, spawned from auth_rides_sweep(${tenantId}, ${hours})`)),
    ] as Array<{ completed: number; expired: number; spawned: number }>;
    return {
      completed: Number(row?.completed ?? 0),
      expired: Number(row?.expired ?? 0),
      spawned: Number(row?.spawned ?? 0),
    };
  });
}
