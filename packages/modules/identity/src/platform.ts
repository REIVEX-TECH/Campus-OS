import { and, eq, sql } from 'drizzle-orm';
import { withActor } from '@campusos/db';
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
 *
 * The write no longer happens here. `platform_roles` is not writable by the
 * application role at all (0016): the row policy is SELECT-only, so a direct
 * insert matches nothing. `auth_grant_platform_admin` is the one writer, a
 * definer that promotes only the calling actor and only if their own verified
 * email is on the allowlist it is handed, and writes the audit line in the same
 * statement. The allowlist is still the environment; the check is now the
 * database's rather than only this function's, so a signed-in request cannot
 * write itself a platform-admin row even if a future code path tries to.
 */
export async function ensurePlatformAdmin(
  actor: { userId: string; email: string },
  allowlist: readonly string[],
): Promise<boolean> {
  // A cheap early exit that keeps the empty/unset list fail-closed and avoids a
  // round trip for the overwhelmingly common non-admin sign in. The definer
  // re-checks, so this is a filter, never the guarantee.
  if (!isAllowlisted(actor.email, allowlist)) return false;
  const list =
    allowlist.length === 0
      ? sql`array[]::text[]`
      : sql`array[${sql.join(
          allowlist.map((entry) => sql`${entry}`),
          sql`, `,
        )}]::text[]`;
  return withActor(actor.userId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`select auth_grant_platform_admin(${list}) as granted`)),
    ] as { granted: boolean }[];
    return row?.granted === true;
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
