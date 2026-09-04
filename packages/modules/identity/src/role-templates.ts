import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { withActor, type TenantTransaction } from '@campusos/db';
import { getDb } from '@campusos/db/client';
import { universities } from '@campusos/db/schema';
import { isPermission, type Permission } from '@campusos/core';
import { isPlatformAdmin } from './platform';
import { roleTemplatePermissions, roleTemplates } from './schema/identity';

/**
 * Role definitions: which roles exist and what each one carries.
 *
 * A definition is not a tenant's to own, so these tables have no `tenant_id`
 * and only a platform administrator may write them. Each tenant's own `roles`
 * rows are materialisations, written by `auth_sync_tenant_roles`, which is a
 * definer function because the paths that need it, a sign in and a first
 * community, have no administrator to hand.
 */

export interface RoleTemplate {
  key: string;
  name: string;
  isSystem: boolean;
  permissions: Permission[];
}

export type TemplateRefusal =
  'not_allowed' | 'bad_name' | 'exists' | 'no_such_template' | 'system_template';

/** The shape of a definition's key: lower case words joined by hyphens. */
export const TEMPLATE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The key a new definition takes from its name: "Course Rep" becomes "course-rep". */
export function templateKeyFromName(name: string): string | null {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return TEMPLATE_KEY_PATTERN.test(key) ? key : null;
}

function unique<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

/** Every definition, with what each one carries. Readable by anyone. */
export async function listRoleTemplates(): Promise<RoleTemplate[]> {
  const db = getDb();
  const templates = await db.select().from(roleTemplates).orderBy(asc(roleTemplates.name));
  if (templates.length === 0) return [];
  const permissions = await db
    .select()
    .from(roleTemplatePermissions)
    .where(
      inArray(
        roleTemplatePermissions.templateKey,
        templates.map((t) => t.key),
      ),
    );
  return templates.map((t) => ({
    key: t.key,
    name: t.name,
    isSystem: t.isSystem,
    permissions: permissions
      .filter((p) => p.templateKey === t.key)
      .map((p) => p.permission)
      .filter(isPermission)
      .sort(),
  }));
}

/**
 * Materialise the definitions into one tenant's roles.
 *
 * Inside an existing transaction, because every caller is already in one: the
 * sign in that creates a membership, the tenant that is being created, the
 * first community. Idempotent, and the only way tenant role rows are written
 * outside a platform administrator's own session.
 */
export async function syncTenantRoles(tx: TenantTransaction, tenantId: string): Promise<void> {
  await tx.execute(sql`select auth_sync_tenant_roles(${tenantId})`);
}

/**
 * The same, for every tenant, after a definition changes.
 *
 * Inside the caller's transaction on purpose: a separate connection would not
 * see the change that is the reason for syncing, and would quietly write the
 * old definition back into every tenant.
 */
async function syncEveryTenant(tx: TenantTransaction): Promise<number> {
  const slugs = await tx.select({ slug: universities.slug }).from(universities);
  for (const { slug } of slugs) {
    await tx.execute(sql`select auth_sync_tenant_roles(${slug})`);
  }
  return slugs.length;
}

/**
 * Create a definition. Platform administrators only, and the check runs as the
 * actor so the database policy and the application agree rather than one
 * standing in for the other.
 */
export async function createRoleTemplate(
  actor: { userId: string },
  input: { name: string; permissions: readonly string[] },
): Promise<{ ok: true; template: RoleTemplate } | { ok: false; reason: TemplateRefusal }> {
  const name = input.name.trim();
  const key = templateKeyFromName(name);
  if (!key || name.length > 60) return { ok: false, reason: 'bad_name' };
  if (!(await isPlatformAdmin(actor.userId))) return { ok: false, reason: 'not_allowed' };
  const permissions = unique(input.permissions.filter(isPermission)).sort();
  return withActor(actor.userId, async (tx) => {
    const [inserted] = await tx
      .insert(roleTemplates)
      .values({ key, name })
      .onConflictDoNothing({ target: roleTemplates.key })
      .returning();
    if (!inserted) return { ok: false as const, reason: 'exists' as const };
    for (const permission of permissions) {
      await tx
        .insert(roleTemplatePermissions)
        .values({ templateKey: key, permission })
        .onConflictDoNothing();
    }
    await tx.execute(sql`
      insert into audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
      values (${actor.userId}::uuid, null, 'role_template.created', 'role_template', ${key},
              jsonb_build_object('permissions', ${permissions.join(',')}::text))`);
    await syncEveryTenant(tx);
    return {
      ok: true as const,
      template: { key, name, isSystem: false, permissions },
    };
  });
}

/** Replace what a definition carries. Every tenant's copy follows. */
export async function setRoleTemplatePermissions(
  actor: { userId: string },
  key: string,
  permissions: readonly string[],
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: TemplateRefusal }> {
  if (!(await isPlatformAdmin(actor.userId))) return { ok: false, reason: 'not_allowed' };
  const wanted = unique(permissions.filter(isPermission)).sort();
  return withActor(actor.userId, async (tx) => {
    const [template] = await tx.select().from(roleTemplates).where(eq(roleTemplates.key, key));
    if (!template) return { ok: false as const, reason: 'no_such_template' as const };
    const current = (
      await tx
        .select({ permission: roleTemplatePermissions.permission })
        .from(roleTemplatePermissions)
        .where(eq(roleTemplatePermissions.templateKey, key))
    ).map((r) => r.permission);
    const toAdd = wanted.filter((p) => !current.includes(p));
    const toRemove = current.filter((p) => !(wanted as string[]).includes(p));
    if (toAdd.length === 0 && toRemove.length === 0) return { ok: true as const, changed: false };
    for (const permission of toAdd) {
      await tx
        .insert(roleTemplatePermissions)
        .values({ templateKey: key, permission })
        .onConflictDoNothing();
    }
    if (toRemove.length > 0) {
      await tx
        .delete(roleTemplatePermissions)
        .where(
          and(
            eq(roleTemplatePermissions.templateKey, key),
            inArray(roleTemplatePermissions.permission, toRemove),
          ),
        );
    }
    await tx.update(roleTemplates).set({ updatedAt: new Date() }).where(eq(roleTemplates.key, key));
    await tx.execute(sql`
      insert into audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
      values (${actor.userId}::uuid, null, 'role_template.changed', 'role_template', ${key},
              jsonb_build_object('permissions', ${wanted.join(',')}::text))`);
    await syncEveryTenant(tx);
    return { ok: true as const, changed: true };
  });
}

/**
 * Retire a definition. System definitions are refused: `tenant_admin` holding
 * every permission is what keeps a tenant able to administer itself, and a
 * platform administrator deleting it would lock every university out at once.
 */
export async function deleteRoleTemplate(
  actor: { userId: string },
  key: string,
): Promise<{ ok: true; deleted: boolean } | { ok: false; reason: TemplateRefusal }> {
  if (!(await isPlatformAdmin(actor.userId))) return { ok: false, reason: 'not_allowed' };
  return withActor(actor.userId, async (tx) => {
    const [template] = await tx.select().from(roleTemplates).where(eq(roleTemplates.key, key));
    if (!template) return { ok: false as const, reason: 'no_such_template' as const };
    if (template.isSystem) return { ok: false as const, reason: 'system_template' as const };
    await tx.delete(roleTemplates).where(eq(roleTemplates.key, key));
    // The tenant copies are left standing: deleting a definition retires it
    // from the catalogue, and taking a role off everyone holding it is a
    // separate act somebody should have to mean.
    await tx.execute(sql`
      insert into audit_log (actor_user_id, tenant_id, action, target_type, target_id, meta)
      values (${actor.userId}::uuid, null, 'role_template.deleted', 'role_template', ${key}, '{}'::jsonb)`);
    return { ok: true as const, deleted: true };
  });
}
