import { eq, sql } from 'drizzle-orm';
import { z, type ZodError } from 'zod';
import {
  withActorInTenant,
  withTenantMutation,
  type TenantTransaction,
  type TenantWriteContext,
} from '@campusos/db';
import { getDb } from '@campusos/db/client';
import { universities } from '@campusos/db/schema';
import { err, ok, type Result } from '@campusos/core';
import { joinModeSchema, tenantConfigSchema, type TenantConfig } from '@campusos/core/tenant';
import { recordAudit } from './audit';
import { isPlatformAdmin } from './platform';
import { ensureSystemRoles } from './rbac';
import { tenantConfigs } from './schema/identity';

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

export interface TenantConfigRow {
  slug: string;
  config: unknown;
  version: number;
  updatedAt: Date;
}

/** Every stored tenant configuration. Needs no context: the rows are readable everywhere. */
export async function listTenantConfigs(): Promise<TenantConfigRow[]> {
  const rows = await getDb().select().from(tenantConfigs);
  return rows.map((r) => ({
    slug: r.slug,
    config: r.config,
    version: r.version,
    updatedAt: r.updatedAt,
  }));
}

interface TenantIdentity {
  slug: string;
  name: string;
  timezone: string;
  locale: string;
}

/**
 * The universities row a tenant's scoped tables and RLS key on. False when the
 * slug is taken: a no-op on conflict rather than an error, so two people
 * creating the same tenant at once end with one tenant and one refusal instead
 * of an aborted transaction.
 */
async function insertUniversity(tx: TenantTransaction, u: TenantIdentity): Promise<boolean> {
  const inserted = await tx
    .insert(universities)
    .values({ slug: u.slug, name: u.name, timezone: u.timezone, locale: u.locale })
    .onConflictDoNothing({ target: universities.slug })
    .returning({ slug: universities.slug });
  return inserted.length > 0;
}

async function updateUniversity(tx: TenantTransaction, u: TenantIdentity): Promise<void> {
  await tx
    .update(universities)
    .set({ name: u.name, timezone: u.timezone, locale: u.locale, updatedAt: new Date() })
    .where(eq(universities.slug, u.slug));
}

/** A first row at version 1, or the next version of the existing one. */
async function writeTenantConfig(
  tx: TenantTransaction,
  input: { slug: string; config: unknown; updatedBy: string | null },
): Promise<{ version: number }> {
  const [row] = await tx
    .insert(tenantConfigs)
    .values({ slug: input.slug, config: input.config, updatedBy: input.updatedBy })
    .onConflictDoUpdate({
      target: tenantConfigs.slug,
      set: {
        config: input.config,
        version: sql`${tenantConfigs.version} + 1`,
        updatedAt: new Date(),
        updatedBy: input.updatedBy,
      },
    })
    .returning({ version: tenantConfigs.version });
  return { version: row?.version ?? 1 };
}

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
  // The join policy (joinMode + allowedEmailDomains) is not set at creation: a new
  // tenant starts closed (domain mode, no domains, so nothing auto-joins), and it
  // is changed only through auth_set_join_policy (setJoinPolicy) -- the one
  // guarded, audited writer. The create form never sets it.
  const config: TenantConfig = { ...parsed.data, joinMode: 'domain', allowedEmailDomains: [] };

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

  const [existing] = await getDb()
    .select({ slug: universities.slug })
    .from(universities)
    .where(eq(universities.slug, slug));
  if (!existing) return { ok: false, reason: 'not_found' };

  return withActorInTenant(actor.userId, slug, async (tx) => {
    // The join policy is owned by setJoinPolicy (grant- or manage-members-gated,
    // distinctly audited); the general editor must not change it. Lock the config
    // row and read its CURRENT join policy inside this transaction, so a concurrent
    // setJoinPolicy cannot slip a change in between the read and the write: a name
    // or theme edit here can never rewrite who auto-joins.
    const [locked] = await tx
      .select({ config: tenantConfigs.config })
      .from(tenantConfigs)
      .where(eq(tenantConfigs.slug, slug))
      .for('update');
    const stored = tenantConfigSchema.safeParse(locked?.config);
    const config: TenantConfig = stored.success
      ? {
          ...parsed.data,
          joinMode: stored.data.joinMode,
          allowedEmailDomains: stored.data.allowedEmailDomains,
        }
      : { ...parsed.data, joinMode: 'domain', allowedEmailDomains: [] };

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

// The join policy -- who may auto-join, and how -- is a membership-governance
// lever, not general configuration, so it is written only through a definer
// (auth_set_join_policy, 0024): it authorizes a platform admin under an open
// grant for this tenant or a tenant member with manage-members, refuses consumer
// email providers structurally, writes only the two keys, and audits
// `tenant.join_policy_updated`.

const joinDomain = z
  .string()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i,
    'must be a bare domain, e.g. lgu.edu.pk',
  );

const joinPolicySchema = z.object({
  joinMode: joinModeSchema,
  allowedEmailDomains: z.array(joinDomain).max(50),
});

export type JoinPolicyInput = z.infer<typeof joinPolicySchema>;

export type JoinPolicyRefusal =
  | { reason: 'not_allowed' | 'no_tenant' | 'invalid_mode' }
  | { reason: 'invalid'; issues: string[] }
  | { reason: 'blocked_domain'; domain: string };

function pgTextArray(values: readonly string[]) {
  return values.length === 0
    ? sql`array[]::text[]`
    : sql`array[${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`;
}

/**
 * Change a tenant's auto-join policy.
 *
 * Runs through the write seam (a platform admin under a grant, or a tenant member
 * with manage-members) and calls the definer, which re-checks authority on the
 * unforgeable grant use-row, refuses consumer email providers, writes only the
 * two keys, and audits distinctly. Governs member auto-join, never admin.
 */
export async function setJoinPolicy(
  actor: { userId: string },
  slug: string,
  input: unknown,
  access?: TenantWriteContext,
): Promise<Result<JoinPolicyInput, JoinPolicyRefusal>> {
  const parsed = joinPolicySchema.safeParse(input);
  if (!parsed.success) return err({ reason: 'invalid', issues: issuesOf(parsed.error) });
  const { joinMode, allowedEmailDomains } = parsed.data;
  return withTenantMutation(actor.userId, slug, access, async (tx) => {
    const [row] = [
      ...(await tx.execute(
        sql`select auth_set_join_policy(${slug}, ${joinMode}, ${pgTextArray(allowedEmailDomains)}) as code`,
      )),
    ] as { code: string }[];
    const code = row?.code ?? 'not_allowed';
    if (code === 'ok') return ok({ joinMode, allowedEmailDomains });
    if (code.startsWith('blocked_domain:')) {
      return err({
        reason: 'blocked_domain' as const,
        domain: code.slice('blocked_domain:'.length),
      });
    }
    return err({ reason: code as 'not_allowed' | 'no_tenant' | 'invalid_mode' });
  });
}
