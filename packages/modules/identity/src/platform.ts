import { and, eq } from 'drizzle-orm';
import { withActor } from '@campusos/db';
import { recordAudit } from './audit';
import { platformRoles } from './schema/identity';

/**
 * Platform administration: who may manage the platform itself, as opposed to
 * one university on it.
 *
 * The environment names who MAY be a platform admin (`SUPERADMIN_EMAILS`); a
 * `platform_roles` row records who IS, written once at sign in. It is a
 * bootstrap, not a session: nothing is decided from the environment on a
 * request. Reading the row is done as the person themselves, so no definer
 * function is needed and `platform_roles` keeps FORCE.
 */

export const PLATFORM_ADMIN = 'platform_admin';

/** Whether this address is on the list. Case does not matter. */
export function isAllowlisted(email: string, allowlist: readonly string[]): boolean {
  const needle = email.trim().toLowerCase();
  return needle.length > 0 && allowlist.some((a) => a.trim().toLowerCase() === needle);
}

/**
 * Make a listed person a platform admin, once. Upgrade only: an address later
 * removed from the list keeps the row until a human removes it, in the same
 * way a tenant's configured admins work. True when the row was written now.
 */
export async function ensurePlatformAdmin(
  actor: { userId: string; email: string },
  allowlist: readonly string[],
): Promise<boolean> {
  if (!isAllowlisted(actor.email, allowlist)) return false;
  return withActor(actor.userId, async (tx) => {
    const [inserted] = await tx
      .insert(platformRoles)
      .values({ userId: actor.userId, role: PLATFORM_ADMIN })
      .onConflictDoNothing({ target: platformRoles.userId })
      .returning();
    if (!inserted) return false;
    await recordAudit(tx, {
      actorUserId: actor.userId,
      tenantId: null,
      action: 'platform.admin_granted',
      targetType: 'user',
      targetId: actor.userId,
      meta: { source: 'env' },
    });
    return true;
  });
}

/** Whether this person is a platform admin, read as themselves. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const rows = await withActor(userId, (tx) =>
    tx
      .select({ role: platformRoles.role })
      .from(platformRoles)
      .where(and(eq(platformRoles.userId, userId), eq(platformRoles.role, PLATFORM_ADMIN))),
  );
  return rows.length > 0;
}
