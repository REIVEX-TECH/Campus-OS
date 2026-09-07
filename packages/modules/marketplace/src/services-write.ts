import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { isVerifiedMember } from './access';
import { marketplaceGigPackages, marketplaceGigs } from './schema/services';
import type { MarketplaceSettings } from './manifest';
import { hasContactInfo } from './input';
import { gigInputSchema, hasDuplicateTiers, type GigInput } from './services-input';

/** Selling a service is verified-only, and capped per person to slow abuse. */
export type GigRefusal = 'not_verified' | 'invalid' | 'rate_limited' | 'not_found' | 'contact_info';

/** Gigs one person may create in a rolling hour. */
const GIGS_PER_HOUR = 10;

/**
 * Create a gig with its packages, atomically. Verified members only; each package
 * price and turnaround are capped by settings; a phone number or WhatsApp handle
 * in any gig or package text is refused so contact stays in the messages / order
 * chat (where blocking, reporting and the audit trail live).
 */
export async function createGig(
  actor: { userId: string },
  tenantId: string,
  input: GigInput,
  settings: MarketplaceSettings,
): Promise<Result<{ id: string }, GigRefusal>> {
  const parsed = gigInputSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  const data = parsed.data;
  if (!settings.serviceCategories.includes(data.category)) return err('invalid');
  if (data.packages.length > settings.maxPackagesPerGig) return err('invalid');
  if (hasDuplicateTiers(data.packages)) return err('invalid');
  for (const p of data.packages) {
    if (p.pricePaisa > settings.maxPackagePricePaisa) return err('invalid');
    if (p.deliveryDays > settings.maxDeliveryDays) return err('invalid');
    if (p.revisions > settings.maxRevisions) return err('invalid');
  }
  const contactBits = [
    data.title,
    data.description,
    ...data.packages.flatMap((p) => [p.title, p.description]),
  ];
  if (contactBits.some((s) => hasContactInfo(s))) return err('contact_info');

  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await isVerifiedMember(tx, actor.userId, tenantId))) return err('not_verified');
    const [recent] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from mkt_gigs
        where tenant_id = ${tenantId} and seller_id = ${actor.userId}::uuid
          and created_at > now() - interval '1 hour'`)),
    ] as { n: number }[];
    if ((recent?.n ?? 0) >= GIGS_PER_HOUR) return err('rate_limited');
    const [gig] = await tx
      .insert(marketplaceGigs)
      .values({
        tenantId,
        sellerId: actor.userId,
        title: data.title,
        description: data.description ?? '',
        category: data.category,
      })
      .returning({ id: marketplaceGigs.id });
    const gigId = gig!.id;
    await tx.insert(marketplaceGigPackages).values(
      data.packages.map((p, i) => ({
        tenantId,
        gigId,
        tier: p.tier,
        title: p.title,
        description: p.description ?? '',
        pricePaisa: p.pricePaisa,
        deliveryDays: p.deliveryDays,
        revisions: p.revisions,
        position: i,
      })),
    );
    return ok({ id: gigId });
  });
}

/** How a gig's status may change by the seller. */
export type GigLifecycleRefusal = 'not_found' | 'invalid';

/** Which current statuses each target may be reached from (seller transitions). */
const ALLOWED_FROM: Record<'active' | 'paused', string[]> = {
  paused: ['active'],
  active: ['paused'],
};

/**
 * The seller pauses their own gig (hidden from browse, existing orders unaffected)
 * or un-pauses it. Only the seller's own, non-deleted gig moves, along an allowed
 * edge.
 */
export async function setGigStatus(
  actor: { userId: string },
  tenantId: string,
  gigId: string,
  next: 'active' | 'paused',
): Promise<Result<{ changed: boolean }, GigLifecycleRefusal>> {
  const from = ALLOWED_FROM[next];
  if (!from) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update mkt_gigs set status = ${next}, edited_at = now()
        where id = ${gigId}::uuid and tenant_id = ${tenantId}
          and seller_id = ${actor.userId}::uuid and deleted_at is null
          and status in (${sql.join(
            from.map((s) => sql`${s}`),
            sql`, `,
          )})
        returning id`)),
    ];
    return ok({ changed: rows.length > 0 });
  });
}

/** The seller takes their own gig down for good (soft-delete). Existing orders,
 *  which snapshot the gig, are unaffected. */
export async function deleteGig(
  actor: { userId: string },
  tenantId: string,
  gigId: string,
): Promise<Result<{ changed: boolean }, GigLifecycleRefusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update mkt_gigs set deleted_at = now(), status = 'removed', edited_at = now()
        where id = ${gigId}::uuid and tenant_id = ${tenantId}
          and seller_id = ${actor.userId}::uuid and deleted_at is null
        returning id`)),
    ];
    return ok({ changed: rows.length > 0 });
  });
}
