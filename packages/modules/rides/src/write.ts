import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { isVerifiedMember } from './access';
import { ridePosts } from './schema/rides';
import { containsContactInfo, rideInputSchema, type RideInput } from './input';
import type { RidesSettings } from './manifest';

export type RideRefusal =
  'not_verified' | 'invalid' | 'rate_limited' | 'not_found' | 'contact_info' | 'seats' | 'past';

/** Rides one person may post in a rolling hour. */
const RIDES_PER_HOUR = 12;

/**
 * Post a ride offer or request. Verified members only, capped per person to slow
 * abuse. Contact details in the note are refused (no off-platform contact / no
 * fees). A departure must be in the future; an offer's seats are capped by the
 * tenant's `maxSeatsPerOffer`.
 */
export async function createRidePost(
  actor: { userId: string },
  tenantId: string,
  input: RideInput,
  settings: RidesSettings,
): Promise<Result<{ id: string }, RideRefusal>> {
  const parsed = rideInputSchema.safeParse(input);
  if (!parsed.success) {
    const contact = parsed.error.issues.some((i) => i.message === 'contact_info');
    return err(contact ? 'contact_info' : 'invalid');
  }
  const data = parsed.data;
  const departAt = new Date(data.departAt);
  if (Number.isNaN(departAt.getTime())) return err('invalid');
  if (departAt.getTime() <= Date.now()) return err('past');
  if (data.kind === 'offer') {
    if (typeof data.seats !== 'number') return err('seats');
    if (data.seats > settings.maxSeatsPerOffer) return err('seats');
  }
  if (data.notes && data.notes.length > settings.notesMaxLength) return err('invalid');

  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    const [recent] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from ride_posts
        where tenant_id = ${tenantId} and author_id = ${actor.userId}::uuid
          and created_at > now() - interval '1 hour'`)),
    ] as { n: number }[];
    if ((recent?.n ?? 0) >= RIDES_PER_HOUR) return err('rate_limited');
    const seats = data.kind === 'offer' ? (data.seats ?? null) : null;
    const [row] = await tx
      .insert(ridePosts)
      .values({
        tenantId,
        authorId: actor.userId,
        kind: data.kind,
        originText: data.originText,
        destText: data.destText,
        originLat: data.originLat ?? null,
        originLng: data.originLng ?? null,
        destLat: data.destLat ?? null,
        destLng: data.destLng ?? null,
        departAt,
        seatsTotal: seats,
        seatsAvailable: seats,
        notes: data.notes ?? '',
        womenOnly: data.womenOnly,
        recurrence: data.recurrence ?? null,
      })
      .returning({ id: ridePosts.id });
    return ok({ id: row!.id });
  });
}

/** Fields a ride's author may change while it is still active. */
export interface RideEdit {
  originText?: string;
  destText?: string;
  departAt?: string;
  notes?: string;
  womenOnly?: boolean;
}

/**
 * Edit one's own active ride. Only the author's own `active` ride changes (scoped
 * in the WHERE, the posts pattern); a note with contact details is refused, a
 * departure must stay in the future.
 */
export async function editRide(
  actor: { userId: string },
  tenantId: string,
  rideId: string,
  edit: RideEdit,
): Promise<Result<{ changed: boolean }, RideRefusal>> {
  if (edit.notes !== undefined && containsContactInfo(edit.notes)) return err('contact_info');
  if (edit.departAt !== undefined) {
    const d = new Date(edit.departAt);
    if (Number.isNaN(d.getTime())) return err('invalid');
    if (d.getTime() <= Date.now()) return err('past');
  }
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update ride_posts set
          origin_text = coalesce(${edit.originText ?? null}, origin_text),
          dest_text = coalesce(${edit.destText ?? null}, dest_text),
          depart_at = coalesce(${edit.departAt ?? null}::timestamptz, depart_at),
          notes = coalesce(${edit.notes ?? null}, notes),
          women_only = coalesce(${edit.womenOnly ?? null}, women_only),
          edited_at = now(), updated_at = now()
        where id = ${rideId}::uuid and tenant_id = ${tenantId}
          and author_id = ${actor.userId}::uuid and status = 'active'
        returning id`)),
    ];
    return ok({ changed: rows.length > 0 });
  });
}

/**
 * Cancel one's own ride. Only an `active`/`full` ride the caller authored is
 * cancelled. Declining any pending seat requests and notifying accepted riders
 * arrives with the seat-request PR; here the ride simply leaves browse.
 */
export async function cancelRide(
  actor: { userId: string },
  tenantId: string,
  rideId: string,
): Promise<Result<{ changed: boolean }, RideRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update ride_posts set status = 'cancelled', cancelled_at = now(), updated_at = now()
        where id = ${rideId}::uuid and tenant_id = ${tenantId}
          and author_id = ${actor.userId}::uuid and status IN ('active', 'full')
        returning id`)),
    ];
    return ok({ changed: rows.length > 0 });
  });
}
