import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withActor, withActorInTenant, type TenantTransaction } from '@campusos/db';
import { getDb } from '@campusos/db/client';
import { err, ok, type Result } from '@campusos/core';
import { recordAudit } from './audit';
import { grantVerified, isVerified, membershipFor, type VerificationMethod } from './membership';
import { tenantMemberships, verificationRequests } from './schema/identity';

/**
 * Asking to be verified, and answering.
 *
 * Someone whose email is not on the university's domain can ask to be
 * recognised by giving an admin enough to check against the university's own
 * records. The admin approves or rejects. Three things are enforced on both
 * sides of the database boundary:
 *
 *  - A person can only ever create their own pending request (RLS: WITH CHECK
 *    on insert) and can never change one (RLS: update needs a tenant context,
 *    which their own request never runs in).
 *  - A decision runs in a tenant context, re-checks that the actor holds the
 *    tenant_admin role inside the same transaction, and refuses to decide the
 *    actor's own request.
 *  - Deciding is idempotent: the request row is locked, and a request already
 *    decided says so rather than being decided twice.
 *
 * The submitted details are purged on decision. What a request leaves behind is
 * its status and its timestamps, which is what the rate limit and the audit
 * trail need and nothing more.
 */

export const REQUEST_WINDOW_DAYS = 30;
export const REQUESTS_PER_WINDOW = 3;

/** What a person gives an admin to check. The minimum that can be checked. */
export const verificationDetailsSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  rollNumber: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type VerificationDetails = z.infer<typeof verificationDetailsSchema>;

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface VerificationRequest {
  id: string;
  tenantId: string;
  userId: string;
  status: RequestStatus;
  createdAt: Date;
  decidedAt: Date | null;
}

type Row = typeof verificationRequests.$inferSelect;

function toRequest(row: Row): VerificationRequest {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    status: row.status as RequestStatus,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? null,
  };
}

export type RequestRefusal = 'already_verified' | 'open_request' | 'rate_limited';

/**
 * Ask to be verified in a tenant. Runs as the person, never in a tenant
 * context, so the database itself refuses anything but their own pending row.
 */
export async function requestVerification(
  userId: string,
  tenantId: string,
  details: VerificationDetails,
): Promise<Result<VerificationRequest, RequestRefusal>> {
  if (isVerified(await membershipFor(userId, tenantId))) return err('already_verified');

  return withActor(userId, async (tx) => {
    const since = new Date(Date.now() - REQUEST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [counted] = await tx
      .select({ recent: sql<number>`count(*)::int` })
      .from(verificationRequests)
      .where(
        and(
          eq(verificationRequests.userId, userId),
          eq(verificationRequests.tenantId, tenantId),
          gt(verificationRequests.createdAt, since),
        ),
      );
    if ((counted?.recent ?? 0) >= REQUESTS_PER_WINDOW) return err('rate_limited');

    // One open request per person per tenant. Checked first, and the partial
    // unique index absorbs the race with DO NOTHING rather than an error: an
    // error inside a transaction aborts it, so a refusal must never be one.
    const [open] = await tx
      .select({ id: verificationRequests.id })
      .from(verificationRequests)
      .where(
        and(
          eq(verificationRequests.userId, userId),
          eq(verificationRequests.tenantId, tenantId),
          eq(verificationRequests.status, 'pending'),
        ),
      );
    if (open) return err('open_request');

    const [row] = await tx
      .insert(verificationRequests)
      .values({
        tenantId,
        userId,
        status: 'pending',
        fullName: details.fullName,
        rollNumber: details.rollNumber,
        note: details.note ?? null,
      })
      .onConflictDoNothing({
        target: [verificationRequests.tenantId, verificationRequests.userId],
        where: sql`${verificationRequests.status} = 'pending'`,
      })
      .returning();
    if (!row) return err('open_request');

    await recordAudit(tx, {
      actorUserId: userId,
      tenantId,
      action: 'verification.requested',
      targetType: 'verification_request',
      targetId: row.id,
    });
    return ok(toRequest(row));
  });
}

/** A person's latest request in a tenant, so their account page can say. */
export async function latestRequest(
  userId: string,
  tenantId: string,
): Promise<VerificationRequest | null> {
  const [row] = await withActor(userId, (tx) =>
    tx
      .select()
      .from(verificationRequests)
      .where(
        and(eq(verificationRequests.userId, userId), eq(verificationRequests.tenantId, tenantId)),
      )
      .orderBy(desc(verificationRequests.createdAt))
      .limit(1),
  );
  return row ? toRequest(row) : null;
}

/**
 * Whether the actor holds the tenant_admin role in this tenant, read inside the
 * transaction that is about to rely on it. The application checks this before
 * rendering anything; this is the check that counts.
 */
async function isTenantAdmin(
  tx: TenantTransaction,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.role, 'tenant_admin'),
        eq(tenantMemberships.status, 'active'),
      ),
    );
  return row !== undefined;
}

export interface PendingRequest {
  id: string;
  userId: string;
  handle: string;
  avatarSeed: string;
  fullName: string;
  rollNumber: string;
  note: string | null;
  createdAt: Date;
}

/**
 * What is waiting in a tenant, oldest first, with the public handle beside
 * each. The handle comes from `public_profiles`, so no email is ever read: an
 * admin checks the submitted details against the university's records, not the
 * address, and the address stays where it was.
 */
export async function listPendingRequests(
  admin: { userId: string },
  tenantId: string,
): Promise<Result<PendingRequest[], 'not_admin'>> {
  return withActorInTenant(admin.userId, tenantId, async (tx) => {
    if (!(await isTenantAdmin(tx, admin.userId, tenantId))) return err('not_admin');
    const rows = [
      ...(await tx.execute(sql`
        select r.id, r.user_id, p.handle, p.avatar_seed, r.full_name, r.roll_number, r.note, r.created_at
        from verification_requests r
        join public_profiles p on p.user_id = r.user_id
        where r.tenant_id = ${tenantId} and r.status = 'pending'
        order by r.created_at asc
        limit 100`)),
    ] as {
      id: string;
      user_id: string;
      handle: string;
      avatar_seed: string;
      full_name: string;
      roll_number: string;
      note: string | null;
      created_at: string | Date;
    }[];
    return ok(
      rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        handle: r.handle,
        avatarSeed: r.avatar_seed,
        fullName: r.full_name,
        rollNumber: r.roll_number,
        note: r.note,
        createdAt: new Date(r.created_at),
      })),
    );
  });
}

export type Decision = 'approve' | 'reject';
export type DecisionRefusal = 'not_admin' | 'not_found' | 'self';
export type DecisionOutcome =
  | { outcome: 'decided'; decision: Decision; membershipCreated: boolean }
  | { outcome: 'already_decided'; status: RequestStatus };

/**
 * Approve or reject. One transaction: the admin role is re-checked, the request
 * row is locked, a request already decided is reported rather than redecided,
 * an approval creates a verified membership or verifies the one that exists,
 * the details are purged, and the decision is audited.
 */
export async function decideRequest(
  admin: { userId: string },
  tenantId: string,
  requestId: string,
  decision: Decision,
): Promise<Result<DecisionOutcome, DecisionRefusal>> {
  return withActorInTenant(admin.userId, tenantId, async (tx) => {
    if (!(await isTenantAdmin(tx, admin.userId, tenantId))) return err('not_admin');

    const [request] = await tx
      .select()
      .from(verificationRequests)
      .where(
        and(eq(verificationRequests.id, requestId), eq(verificationRequests.tenantId, tenantId)),
      )
      .for('update');
    if (!request) return err('not_found');
    // Nobody decides their own request, whatever role they hold.
    if (request.userId === admin.userId) return err('self');
    if (request.status !== 'pending') {
      return ok({ outcome: 'already_decided', status: request.status as RequestStatus });
    }

    let membershipCreated = false;
    if (decision === 'approve') {
      const granted = await grantVerified(tx, {
        tenantId,
        userId: request.userId,
        method: 'admin',
        actorUserId: admin.userId,
      });
      membershipCreated = granted.created;
    }

    await tx
      .update(verificationRequests)
      .set({
        status: decision === 'approve' ? 'approved' : 'rejected',
        decidedBy: admin.userId,
        decidedAt: new Date(),
        // Purged: the details have done their one job.
        fullName: null,
        rollNumber: null,
        note: null,
      })
      .where(eq(verificationRequests.id, request.id));

    await recordAudit(tx, {
      actorUserId: admin.userId,
      tenantId,
      action: decision === 'approve' ? 'verification.approved' : 'verification.rejected',
      targetType: 'verification_request',
      targetId: request.id,
      meta: { targetUserId: request.userId, membershipCreated },
    });
    return ok({ outcome: 'decided', decision, membershipCreated });
  });
}

/**
 * Mark a member verified by hand, without a request. Same guards as a decision:
 * admin role re-checked in the transaction, never oneself.
 */
export async function verifyMember(
  admin: { userId: string },
  tenantId: string,
  targetUserId: string,
): Promise<Result<{ created: boolean; alreadyVerified: boolean }, DecisionRefusal>> {
  return withActorInTenant(admin.userId, tenantId, async (tx) => {
    if (!(await isTenantAdmin(tx, admin.userId, tenantId))) return err('not_admin');
    if (targetUserId === admin.userId) return err('self');
    // Only an active user can be a member. Checked on the public view first,
    // because a foreign key failure would abort the transaction.
    const exists = [
      ...(await tx.execute(
        sql`select 1 from public_profiles where user_id = ${targetUserId}::uuid limit 1`,
      )),
    ];
    if (exists.length === 0) return err('not_found');
    const granted = await grantVerified(tx, {
      tenantId,
      userId: targetUserId,
      method: 'admin',
      actorUserId: admin.userId,
    });
    return ok({ created: granted.created, alreadyVerified: granted.alreadyVerified });
  });
}

/** The user behind a public handle, or null. Reads only the public view. */
export async function userIdByHandle(handle: string): Promise<string | null> {
  const rows = [
    ...(await getDb().execute(
      sql`select user_id from public_profiles where lower(handle) = lower(${handle}) limit 1`,
    )),
  ] as { user_id?: string }[];
  return rows[0]?.user_id ?? null;
}

export interface MemberSummary {
  userId: string;
  handle: string;
  avatarSeed: string;
  role: string;
  status: string;
  verifiedAt: Date | null;
  verificationMethod: VerificationMethod | null;
  createdAt: Date;
}

/** The members of a tenant, newest first, for an admin. Handles, never emails. */
export async function listMembers(
  admin: { userId: string },
  tenantId: string,
  limit = 50,
): Promise<Result<MemberSummary[], 'not_admin'>> {
  return withActorInTenant(admin.userId, tenantId, async (tx) => {
    if (!(await isTenantAdmin(tx, admin.userId, tenantId))) return err('not_admin');
    const rows = [
      ...(await tx.execute(sql`
        select m.user_id, p.handle, p.avatar_seed, m.role, m.status, m.verified_at, m.verification_method, m.created_at
        from tenant_memberships m
        join public_profiles p on p.user_id = m.user_id
        where m.tenant_id = ${tenantId}
        order by m.created_at desc
        limit ${limit}`)),
    ] as {
      user_id: string;
      handle: string;
      avatar_seed: string;
      role: string;
      status: string;
      verified_at: string | Date | null;
      verification_method: string | null;
      created_at: string | Date;
    }[];
    return ok(
      rows.map((r) => ({
        userId: r.user_id,
        handle: r.handle,
        avatarSeed: r.avatar_seed,
        role: r.role,
        status: r.status,
        verifiedAt: r.verified_at ? new Date(r.verified_at) : null,
        verificationMethod: (r.verification_method as VerificationMethod | null) ?? null,
        createdAt: new Date(r.created_at),
      })),
    );
  });
}
