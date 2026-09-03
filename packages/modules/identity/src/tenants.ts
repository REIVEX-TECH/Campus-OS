import { eq } from 'drizzle-orm';
import type { ZodError } from 'zod';
import { withActorInTenant } from '@campusos/db';
import { getDb } from '@campusos/db/client';
import { insertUniversity, updateUniversity, writeTenantConfig } from '@campusos/db/repositories';
import { universities } from '@campusos/db/schema';
import { tenantConfigSchema, type TenantConfig } from '@campusos/core/tenant';
import { recordAudit } from './audit';
import { isPlatformAdmin } from './platform';
import { ensureSystemRoles } from './rbac';

/**
 * Creating a university, and changing one.
 *
 * Both are a platform administrator's to do. The application checks that
 * first; the row policies on tenant_configs check it again at the write, as
 * the actor themselves. A creation is one transaction: the universities row
 * every scoped table keys on, the configuration, the three system roles so the
 * tenant can administer itself from the first moment, and one audit line, all
 * of which commit or fail together. The slug is permanent (CLAUDE.md 4): an
 * update that names a different one is refused.
 */

export type TenantWriteRefusal =
  | { reason: 'not_allowed' }
  | { reason: 'exists' }
  | { reason: 'not_found' }
  | { reason: 'slug_mismatch' }
  | { reason: 'invalid'; issues: string[] };

export type TenantWriteResult =
  { ok: true; config: TenantConfig; version: number } | ({ ok: false } & TenantWriteRefusal);

function issuesOf(error: ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`);
}

export async function createTenant(
  actor: { userId: string },
  input: unknown,
): Promise<TenantWriteResult> {
  if (!(await isPlatformAdmin(actor.userId))) return { ok: false, reason: 'not_allowed' };
  const parsed = tenantConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid', issues: issuesOf(parsed.error) };
  const config = parsed.data;

  return withActorInTenant(actor.userId, config.slug, async (tx) => {
    const created = await insertUniversity(tx, {
      slug: config.slug,
      name: config.displayName,
      timezone: config.timezone,
      locale: config.locale,
    });
    if (!created) return { ok: false as const, reason: 'exists' as const };
    const { version } = await writeTenantConfig(tx, {
      slug: config.slug,
      config,
      updatedBy: actor.userId,
    });
    await ensureSystemRoles(tx, config.slug);
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId: config.slug,
      action: 'tenant.created',
      targetType: 'tenant',
      targetId: config.slug,
      meta: { version },
    });
    return { ok: true as const, config, version };
  });
}

export async function updateTenantConfig(
  actor: { userId: string },
  slug: string,
  input: unknown,
): Promise<TenantWriteResult> {
  if (!(await isPlatformAdmin(actor.userId))) return { ok: false, reason: 'not_allowed' };
  const parsed = tenantConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid', issues: issuesOf(parsed.error) };
  if (parsed.data.slug !== slug) return { ok: false, reason: 'slug_mismatch' };
  const config = parsed.data;

  const [existing] = await getDb()
    .select({ slug: universities.slug })
    .from(universities)
    .where(eq(universities.slug, slug));
  if (!existing) return { ok: false, reason: 'not_found' };

  return withActorInTenant(actor.userId, slug, async (tx) => {
    await updateUniversity(tx, {
      slug,
      name: config.displayName,
      timezone: config.timezone,
      locale: config.locale,
    });
    const { version } = await writeTenantConfig(tx, { slug, config, updatedBy: actor.userId });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId: slug,
      action: 'tenant.updated',
      targetType: 'tenant',
      targetId: slug,
      meta: { version },
    });
    return { ok: true as const, config, version };
  });
}
