import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { isVerifiedMember } from './access';
import { lostFoundClaimMessages, lostFoundClaims } from './schema/lost-found';

/**
 * Claims and their private thread.
 *
 * Opening a claim needs a verified member who is not the reporter, on an open
 * item. Visibility is enforced by RLS (claimant or item reporter only); the
 * reporter confirms — which resolves the item and denies the rest — or rejects,
 * and the claimant may withdraw. Every write re-checks who the actor is.
 */
export type ClaimRefusal =
  'not_verified' | 'not_found' | 'not_allowed' | 'own_item' | 'not_open' | 'exists' | 'invalid';

export interface ClaimSummary {
  id: string;
  claimantId: string;
  claimantHandle: string | null;
  claimantAvatarSeed: string | null;
  status: string;
  message: string;
  createdAt: Date;
}

export interface ClaimMessageView {
  id: string;
  senderId: string;
  senderHandle: string | null;
  body: string;
  createdAt: Date;
}

export interface MyClaim {
  id: string;
  status: string;
  createdAt: Date;
  itemId: string;
  itemTitle: string;
  itemKind: string;
  itemStatus: string;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function openClaim(
  actor: { userId: string },
  tenantId: string,
  itemId: string,
  message: string,
): Promise<Result<{ id: string }, ClaimRefusal>> {
  const text = message.trim();
  if (text.length < 3 || text.length > 2000) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    const [item] = [
      ...(await tx.execute(sql`
        select reporter_id, status from lf_items
        where id = ${itemId}::uuid and tenant_id = ${tenantId} and deleted_at is null limit 1`)),
    ] as { reporter_id: string; status: string }[];
    if (!item) return err('not_found');
    if (item.reporter_id === actor.userId) return err('own_item');
    if (item.status !== 'open') return err('not_open');
    const [row] = await tx
      .insert(lostFoundClaims)
      .values({ tenantId, itemId, claimantId: actor.userId, message: text })
      .onConflictDoNothing({
        target: [lostFoundClaims.itemId, lostFoundClaims.claimantId],
        where: sql`status = 'pending'`,
      })
      .returning({ id: lostFoundClaims.id });
    if (!row) return err('exists');
    return ok({ id: row.id });
  });
}

export async function sendClaimMessage(
  actor: { userId: string },
  tenantId: string,
  claimId: string,
  body: string,
): Promise<Result<{ id: string }, ClaimRefusal>> {
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    // RLS returns the claim only to a participant; a stranger sees nothing.
    const [claim] = [
      ...(await tx.execute(sql`
        select id, status from lf_claims
        where id = ${claimId}::uuid and tenant_id = ${tenantId} limit 1`)),
    ] as { id: string; status: string }[];
    if (!claim) return err('not_found');
    const [row] = await tx
      .insert(lostFoundClaimMessages)
      .values({ tenantId, claimId, senderId: actor.userId, body: text })
      .returning({ id: lostFoundClaimMessages.id });
    return ok({ id: row!.id });
  });
}

/** Confirm a claim: resolve the item, deny the other pending claims. Reporter only. */
export async function confirmClaim(
  actor: { userId: string },
  tenantId: string,
  claimId: string,
): Promise<Result<Record<string, never>, ClaimRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [claim] = [
      ...(await tx.execute(sql`
        select c.id, c.item_id, c.status as claim_status, i.reporter_id, i.status as item_status
        from lf_claims c join lf_items i on i.id = c.item_id
        where c.id = ${claimId}::uuid and c.tenant_id = ${tenantId} limit 1`)),
    ] as {
      id: string;
      item_id: string;
      claim_status: string;
      reporter_id: string;
      item_status: string;
    }[];
    if (!claim) return err('not_found');
    if (claim.reporter_id !== actor.userId) return err('not_allowed');
    if (claim.claim_status !== 'pending') return err('not_found');
    if (claim.item_status !== 'open') return err('not_open');
    await tx.execute(
      sql`update lf_claims set status = 'approved', decided_at = now() where id = ${claimId}::uuid`,
    );
    await tx.execute(sql`
      update lf_items
      set status = 'resolved', resolved_via_claim_id = ${claimId}::uuid, resolved_at = now(), edited_at = now()
      where id = ${claim.item_id}::uuid`);
    await tx.execute(sql`
      update lf_claims set status = 'denied', decided_at = now()
      where item_id = ${claim.item_id}::uuid and status = 'pending' and id <> ${claimId}::uuid`);
    return ok({});
  });
}

/** Reject a claim. Reporter only. */
export async function rejectClaim(
  actor: { userId: string },
  tenantId: string,
  claimId: string,
): Promise<Result<Record<string, never>, ClaimRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [claim] = [
      ...(await tx.execute(sql`
        select c.status as claim_status, i.reporter_id
        from lf_claims c join lf_items i on i.id = c.item_id
        where c.id = ${claimId}::uuid and c.tenant_id = ${tenantId} limit 1`)),
    ] as { claim_status: string; reporter_id: string }[];
    if (!claim) return err('not_found');
    if (claim.reporter_id !== actor.userId) return err('not_allowed');
    if (claim.claim_status !== 'pending') return err('not_found');
    await tx.execute(
      sql`update lf_claims set status = 'denied', decided_at = now() where id = ${claimId}::uuid`,
    );
    return ok({});
  });
}

/** Withdraw one's own pending claim. Claimant only. */
export async function withdrawClaim(
  actor: { userId: string },
  tenantId: string,
  claimId: string,
): Promise<Result<Record<string, never>, ClaimRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update lf_claims set status = 'withdrawn', decided_at = now()
        where id = ${claimId}::uuid and tenant_id = ${tenantId}
          and claimant_id = ${actor.userId}::uuid and status = 'pending'
        returning id`)),
    ];
    if (rows.length === 0) return err('not_found');
    return ok({});
  });
}

/** Claims on an item the caller can see: the reporter sees all, a claimant sees theirs. */
export async function listClaimsForItem(
  actor: { userId: string },
  tenantId: string,
  itemId: string,
): Promise<ClaimSummary[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select c.id, c.claimant_id, c.status, c.message, c.created_at,
               p.handle as claimant_handle, p.avatar_seed as claimant_avatar_seed
        from lf_claims c
        left join public_profiles p on p.user_id = c.claimant_id
        where c.tenant_id = ${tenantId} and c.item_id = ${itemId}::uuid and c.deleted_at is null
        order by c.created_at asc`)),
    ] as Array<{
      id: string;
      claimant_id: string;
      status: string;
      message: string;
      created_at: string | Date;
      claimant_handle: string | null;
      claimant_avatar_seed: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      claimantId: r.claimant_id,
      claimantHandle: r.claimant_handle,
      claimantAvatarSeed: r.claimant_avatar_seed,
      status: r.status,
      message: r.message,
      createdAt: toDate(r.created_at),
    }));
  });
}

/** The message thread of one claim, visible only to its participants (RLS). */
export async function claimThread(
  actor: { userId: string },
  tenantId: string,
  claimId: string,
): Promise<ClaimMessageView[]> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select m.id, m.sender_id, m.body, m.created_at, p.handle as sender_handle
        from lf_claim_messages m
        left join public_profiles p on p.user_id = m.sender_id
        where m.tenant_id = ${tenantId} and m.claim_id = ${claimId}::uuid
        order by m.created_at asc`)),
    ] as Array<{
      id: string;
      sender_id: string;
      body: string;
      created_at: string | Date;
      sender_handle: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      senderHandle: r.sender_handle,
      body: r.body,
      createdAt: toDate(r.created_at),
    }));
  });
}

/** Claims the caller has made in one tenant, with the item they are on. */
export async function myClaims(userId: string, tenantId: string): Promise<MyClaim[]> {
  return withActorInTenant(userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select c.id, c.status, c.created_at, c.item_id,
               i.title as item_title, i.kind as item_kind, i.status as item_status
        from lf_claims c join lf_items i on i.id = c.item_id
        where c.tenant_id = ${tenantId} and c.claimant_id = ${userId}::uuid and c.deleted_at is null
        order by c.created_at desc`)),
    ] as Array<{
      id: string;
      status: string;
      created_at: string | Date;
      item_id: string;
      item_title: string;
      item_kind: string;
      item_status: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: toDate(r.created_at),
      itemId: r.item_id,
      itemTitle: r.item_title,
      itemKind: r.item_kind,
      itemStatus: r.item_status,
    }));
  });
}
