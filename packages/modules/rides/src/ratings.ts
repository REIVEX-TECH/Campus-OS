import { sql } from 'drizzle-orm';
import { withActorInTenant, withTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { containsContactInfo } from './input';

/**
 * Ride ratings. Writing goes through the `auth_rides_submit_rating` definer, which
 * re-verifies the pairing (an accepted passenger and the ride's driver, on a
 * completed ride) so the app cannot forge one. Reading is tenant-wide (the ratings
 * are a person's public reputation), aggregated for the profile surface.
 */

export type RatingDirection = 'of_driver' | 'of_passenger';
export type RatingRefusal =
  'invalid' | 'contact_info' | 'not_completed' | 'not_eligible' | 'exists';

/** Submit a 1-5 rating for the other party of a completed ride. */
export async function submitRating(
  actor: { userId: string },
  tenantId: string,
  input: {
    rideId: string;
    ratee: string;
    stars: number;
    direction: RatingDirection;
    comment?: string;
  },
): Promise<Result<{ created: boolean }, RatingRefusal>> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) return err('invalid');
  if (input.direction !== 'of_driver' && input.direction !== 'of_passenger') return err('invalid');
  const comment = input.comment?.trim() || null;
  if (comment && containsContactInfo(comment)) return err('contact_info');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select auth_rides_submit_rating(
          ${input.rideId}::uuid, ${input.ratee}::uuid, ${input.stars},
          ${comment}, ${input.direction}) as result`)),
    ] as { result: string }[];
    const result = row?.result;
    if (result === 'created') return ok({ created: true });
    if (result === 'exists') return ok({ created: false });
    if (result === 'not_completed' || result === 'not_eligible') return err(result);
    return err('invalid');
  });
}

export interface RatingAggregate {
  average: number | null;
  count: number;
}

export interface RatingComment {
  stars: number;
  comment: string;
  direction: RatingDirection;
  createdAt: Date;
}

export interface ProfileRatings {
  asDriver: RatingAggregate;
  asPassenger: RatingAggregate;
  recent: RatingComment[];
}

/** A person's ride reputation, for their public profile. Tenant-scoped read. */
export async function ratingsForUser(tenantId: string, userId: string): Promise<ProfileRatings> {
  return withTenant(tenantId, async (tx) => {
    const agg = [
      ...(await tx.execute(sql`
        select direction, avg(stars)::float as average, count(*)::int as count
        from ride_ratings
        where tenant_id = ${tenantId} and ratee_id = ${userId}::uuid
        group by direction`)),
    ] as Array<{ direction: string; average: number | null; count: number }>;
    const forDir = (d: RatingDirection): RatingAggregate => {
      const row = agg.find((a) => a.direction === d);
      return { average: row?.average ?? null, count: row?.count ?? 0 };
    };
    const recent = [
      ...(await tx.execute(sql`
        select stars, comment, direction, created_at from ride_ratings
        where tenant_id = ${tenantId} and ratee_id = ${userId}::uuid and comment is not null
        order by created_at desc limit 10`)),
    ] as Array<{ stars: number; comment: string; direction: string; created_at: string | Date }>;
    return {
      asDriver: forDir('of_driver'),
      asPassenger: forDir('of_passenger'),
      recent: recent.map((r) => ({
        stars: r.stars,
        comment: r.comment,
        direction: r.direction as RatingDirection,
        createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      })),
    };
  });
}
