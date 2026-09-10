import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withActorInTenant, withTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';

/**
 * Ride share links. A link is a bearer token: a random secret whose sha256 hash is
 * stored, while the raw token travels only in the shareable URL (never a ride or
 * user id, CLAUDE.md 8). The public page is served on the tenant host, so every
 * read here is tenant-scoped exactly like the ride page; the token is the
 * capability, matched by hash within the tenant. No SECURITY DEFINER.
 */

export type ShareRefusal = 'not_eligible' | 'not_found';

/** Hash a raw token for storage / lookup. */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Create a share link for a ride. Only the driver or an accepted passenger may
 * publish one (both are readable in the caller's own RLS context). Returns the raw
 * token once; it is never retrievable again.
 */
export async function createShareLink(
  actor: { userId: string },
  tenantId: string,
  rideId: string,
): Promise<Result<{ token: string }, ShareRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const eligible = [
      ...(await tx.execute(sql`
        select 1 from ride_posts p
        where p.id = ${rideId}::uuid and p.tenant_id = ${tenantId}
          and p.removed_at is null and p.status <> 'cancelled'
          and (
            p.author_id = ${actor.userId}::uuid
            or exists (
              select 1 from ride_seat_requests r
              where r.ride_post_id = p.id and r.passenger_id = ${actor.userId}::uuid
                and r.status = 'accepted'
            )
          )
        limit 1`)),
    ];
    if (eligible.length === 0) return err('not_eligible');
    const raw = randomBytes(32).toString('base64url');
    const inserted = [
      ...(await tx.execute(sql`
        insert into ride_share_tokens (tenant_id, ride_post_id, token_hash, created_by, expires_at)
        select ${tenantId}, p.id, ${hashToken(raw)}, ${actor.userId}::uuid, p.depart_at + interval '1 day'
        from ride_posts p
        where p.id = ${rideId}::uuid and p.tenant_id = ${tenantId}
        returning id`)),
    ];
    if (inserted.length === 0) return err('not_found');
    return ok({ token: raw });
  });
}

/**
 * Revoke every live link on a ride that the caller created, or all of them if the
 * caller is the driver. Returns how many were revoked.
 */
export async function revokeShareLinks(
  actor: { userId: string },
  tenantId: string,
  rideId: string,
): Promise<Result<{ revoked: number }, ShareRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update ride_share_tokens t set revoked_at = now()
        where t.tenant_id = ${tenantId} and t.ride_post_id = ${rideId}::uuid
          and t.revoked_at is null
          and (
            t.created_by = ${actor.userId}::uuid
            or exists (
              select 1 from ride_posts p
              where p.id = t.ride_post_id and p.author_id = ${actor.userId}::uuid
            )
          )
        returning t.id`)),
    ];
    return ok({ revoked: rows.length });
  });
}

/** Whether the caller has a live (unrevoked, unexpired) link on this ride. */
export async function hasActiveShareLink(
  actor: { userId: string },
  tenantId: string,
  rideId: string,
): Promise<boolean> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select 1 from ride_share_tokens t
        where t.tenant_id = ${tenantId} and t.ride_post_id = ${rideId}::uuid
          and t.created_by = ${actor.userId}::uuid
          and t.revoked_at is null and t.expires_at > now()
        limit 1`)),
    ];
    return rows.length > 0;
  });
}

export interface SharedRideView {
  originText: string;
  destText: string;
  departAt: Date;
  seatsTotal: number | null;
  seatsAvailable: number | null;
  womenOnly: boolean;
  notes: string;
  driverHandle: string | null;
}

/**
 * Resolve a raw share token to the minimal public trip view, within one tenant.
 * Returns null for an unknown, revoked, expired, removed, or cancelled ride. No
 * emails, no rider list, no ids. Tenant-scoped (the page is served on the tenant
 * host), so this needs no actor and no definer.
 */
export async function resolveSharedRide(
  tenantId: string,
  rawToken: string,
): Promise<SharedRideView | null> {
  const tokenHash = hashToken(rawToken);
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select p.origin_text, p.dest_text, p.depart_at,
               p.seats_total, p.seats_available, p.women_only, p.notes,
               pp.handle as driver_handle
        from ride_share_tokens t
        join ride_posts p on p.id = t.ride_post_id and p.tenant_id = t.tenant_id
        left join public_profiles pp on pp.user_id = p.author_id
        where t.tenant_id = ${tenantId}
          and t.token_hash = ${tokenHash}
          and t.revoked_at is null
          and t.expires_at > now()
          and p.removed_at is null
          and p.status <> 'cancelled'
        limit 1`)),
    ] as Array<{
      origin_text: string;
      dest_text: string;
      depart_at: string | Date;
      seats_total: number | null;
      seats_available: number | null;
      women_only: boolean;
      notes: string;
      driver_handle: string | null;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
      originText: r.origin_text,
      destText: r.dest_text,
      departAt: r.depart_at instanceof Date ? r.depart_at : new Date(r.depart_at),
      seatsTotal: r.seats_total,
      seatsAvailable: r.seats_available,
      womenOnly: r.women_only,
      notes: r.notes,
      driverHandle: r.driver_handle,
    };
  });
}
