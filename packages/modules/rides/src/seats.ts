import { sql } from 'drizzle-orm';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { notifyInTx } from '@campusos/module-notifications/notify';
import { isVerifiedMember } from './access';

/**
 * Seat requests: a passenger asking for a seat on an offer, and the driver's
 * accept/decline. Both sides are verified members, blocks are honored either way,
 * and the seat ledger on the ride is decremented atomically on accept (to zero
 * flips the ride to `full`). Accept/decline are the driver's act on their own ride
 * under the participant policy — no definer. The messages system-conversation the
 * accept flow opens is a later PR; here both parties are told through notifications.
 */

export type SeatRequestRefusal =
  | 'not_verified'
  | 'not_found'
  | 'not_available'
  | 'own_ride'
  | 'blocked'
  | 'exists'
  | 'not_pending'
  | 'not_cancellable';

async function blockedBetween(
  tx: TenantTransaction,
  tenantId: string,
  other: string,
): Promise<boolean> {
  const [row] = [
    ...(await tx.execute(sql`select auth_blocked_between(${tenantId}, ${other}::uuid) as blocked`)),
  ] as { blocked: boolean }[];
  return row?.blocked === true;
}

/** A passenger asks for a seat on an active offer. */
export async function requestSeat(
  actor: { userId: string },
  tenantId: string,
  rideId: string,
): Promise<Result<{ id: string }, SeatRequestRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    const [ride] = [
      ...(await tx.execute(sql`
        select id, author_id, kind, status, seats_available, origin_text, dest_text
        from ride_posts
        where id = ${rideId}::uuid and tenant_id = ${tenantId}
        limit 1`)),
    ] as Array<{
      id: string;
      author_id: string;
      kind: string;
      status: string;
      seats_available: number | null;
      origin_text: string;
      dest_text: string;
    }>;
    if (!ride || ride.kind !== 'offer') return err('not_found');
    if (ride.author_id === actor.userId) return err('own_ride');
    if (ride.status !== 'active' || (ride.seats_available ?? 0) <= 0) return err('not_available');
    if (await blockedBetween(tx, tenantId, ride.author_id)) return err('blocked');
    const [existing] = [
      ...(await tx.execute(sql`
        select id from ride_seat_requests
        where ride_post_id = ${rideId}::uuid and passenger_id = ${actor.userId}::uuid
          and status in ('pending', 'accepted')
        limit 1`)),
    ];
    if (existing) return err('exists');
    const [row] = [
      ...(await tx.execute(sql`
        insert into ride_seat_requests (tenant_id, ride_post_id, passenger_id)
        values (${tenantId}, ${rideId}::uuid, ${actor.userId}::uuid)
        returning id`)),
    ] as { id: string }[];
    await notifyInTx(tx, {
      userId: ride.author_id,
      kind: 'rides.seat_requested',
      payload: { originText: ride.origin_text, destText: ride.dest_text },
      link: `rides/${rideId}`,
      actorId: actor.userId,
    });
    return ok({ id: row!.id });
  });
}

/** The driver accepts a pending request: decrement the seat, tell the passenger. */
export async function acceptRequest(
  actor: { userId: string },
  tenantId: string,
  requestId: string,
): Promise<Result<{ seatsAvailable: number }, SeatRequestRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [req] = [
      ...(await tx.execute(sql`
        select rs.id, rs.status, rs.passenger_id, p.id as ride_id, p.author_id,
               p.status as ride_status, p.seats_available, p.origin_text, p.dest_text
        from ride_seat_requests rs
        join ride_posts p on p.id = rs.ride_post_id
        where rs.id = ${requestId}::uuid and rs.tenant_id = ${tenantId}
        limit 1`)),
    ] as Array<{
      id: string;
      status: string;
      passenger_id: string;
      ride_id: string;
      author_id: string;
      ride_status: string;
      seats_available: number | null;
      origin_text: string;
      dest_text: string;
    }>;
    if (!req || req.author_id !== actor.userId) return err('not_found');
    if (req.status !== 'pending') return err('not_pending');
    if (await blockedBetween(tx, tenantId, req.passenger_id)) return err('blocked');
    // Atomic decrement on the driver's own ride; to zero flips it to full.
    const dec = [
      ...(await tx.execute(sql`
        update ride_posts
           set seats_available = seats_available - 1,
               status = case when seats_available - 1 <= 0 then 'full' else status end,
               updated_at = now()
         where id = ${req.ride_id}::uuid and author_id = ${actor.userId}::uuid
           and status in ('active', 'full') and seats_available > 0
        returning seats_available`)),
    ] as { seats_available: number }[];
    if (dec.length === 0) return err('not_available');
    await tx.execute(sql`
      update ride_seat_requests set status = 'accepted', decided_at = now()
      where id = ${requestId}::uuid and status = 'pending'`);
    await notifyInTx(tx, {
      userId: req.passenger_id,
      kind: 'rides.seat_accepted',
      payload: { originText: req.origin_text, destText: req.dest_text },
      link: `rides/${req.ride_id}`,
      actorId: actor.userId,
    });
    return ok({ seatsAvailable: dec[0]!.seats_available });
  });
}

/** The driver declines a pending request. */
export async function declineRequest(
  actor: { userId: string },
  tenantId: string,
  requestId: string,
): Promise<Result<{ changed: boolean }, SeatRequestRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update ride_seat_requests rs set status = 'declined', decided_at = now()
        where rs.id = ${requestId}::uuid and rs.tenant_id = ${tenantId} and rs.status = 'pending'
          and exists (
            select 1 from ride_posts p
            where p.id = rs.ride_post_id and p.author_id = ${actor.userId}::uuid)
        returning rs.passenger_id, rs.ride_post_id`)),
    ] as { passenger_id: string; ride_post_id: string }[];
    if (rows.length === 0) return ok({ changed: false });
    await notifyInTx(tx, {
      userId: rows[0]!.passenger_id,
      kind: 'rides.seat_declined',
      link: `rides/${rows[0]!.ride_post_id}`,
      actorId: actor.userId,
    });
    return ok({ changed: true });
  });
}

/** A passenger cancels their own request; an accepted cancel returns the seat. */
export async function cancelSeatRequest(
  actor: { userId: string },
  tenantId: string,
  requestId: string,
): Promise<Result<{ changed: boolean }, SeatRequestRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [req] = [
      ...(await tx.execute(sql`
        select status, ride_post_id from ride_seat_requests
        where id = ${requestId}::uuid and tenant_id = ${tenantId}
          and passenger_id = ${actor.userId}::uuid
        limit 1`)),
    ] as { status: string; ride_post_id: string }[];
    if (!req) return err('not_found');
    if (req.status !== 'pending' && req.status !== 'accepted') return err('not_cancellable');
    await tx.execute(sql`
      update ride_seat_requests set status = 'cancelled', decided_at = now()
      where id = ${requestId}::uuid and passenger_id = ${actor.userId}::uuid
        and status in ('pending', 'accepted')`);
    if (req.status === 'accepted') {
      // Return the seat; a full ride opens back up.
      await tx.execute(sql`
        update ride_posts
           set seats_available = least(coalesce(seats_available, 0) + 1, seats_total),
               status = case when status = 'full' then 'active' else status end,
               updated_at = now()
         where id = ${req.ride_post_id}::uuid`);
    }
    return ok({ changed: true });
  });
}

export interface SeatRequestSummary {
  id: string;
  status: string;
  passengerId: string;
  passengerHandle: string | null;
  createdAt: Date;
}

/** The requests on a ride, for its author. The participant policy admits the driver. */
export async function requestsForRide(
  actor: { userId: string },
  tenantId: string,
  rideId: string,
): Promise<SeatRequestSummary[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select rs.id, rs.status, rs.passenger_id, rs.created_at, pr.handle as passenger_handle
        from ride_seat_requests rs
        left join public_profiles pr on pr.user_id = rs.passenger_id
        where rs.ride_post_id = ${rideId}::uuid and rs.tenant_id = ${tenantId}
        order by rs.created_at asc`)),
    ] as Array<{
      id: string;
      status: string;
      passenger_id: string;
      created_at: string | Date;
      passenger_handle: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      passengerId: r.passenger_id,
      passengerHandle: r.passenger_handle,
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    }));
  });
}

export interface MySeatRequest {
  id: string;
  status: string;
  rideId: string;
  originText: string;
  destText: string;
  departAt: Date;
}

/** A passenger's own seat requests, newest first. */
export async function mySeatRequests(
  actor: { userId: string },
  tenantId: string,
): Promise<MySeatRequest[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select rs.id, rs.status, p.id as ride_id, p.origin_text, p.dest_text, p.depart_at
        from ride_seat_requests rs
        join ride_posts p on p.id = rs.ride_post_id
        where rs.tenant_id = ${tenantId} and rs.passenger_id = ${actor.userId}::uuid
        order by rs.created_at desc`)),
    ] as Array<{
      id: string;
      status: string;
      ride_id: string;
      origin_text: string;
      dest_text: string;
      depart_at: string | Date;
    }>;
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      rideId: r.ride_id,
      originText: r.origin_text,
      destText: r.dest_text,
      departAt: r.depart_at instanceof Date ? r.depart_at : new Date(r.depart_at),
    }));
  });
}
