import { sql } from 'drizzle-orm';
import { withTenant } from '@campusos/db';

/**
 * Hard-delete expired ephemeral messages for one tenant. Read queries already
 * hide anything past `expires_at`; this removes it from the table so it does not
 * linger. It runs with no actor in the tenant context — the DELETE policy (0002)
 * admits only already-expired rows — so it can delete nothing that has not
 * expired, and it never reaches another tenant's rows. Idempotent.
 */
export async function expireMessages(tenantId: string): Promise<{ deleted: number }> {
  // The delete goes through an owner-run definer (0002): a plain app-role DELETE
  // would have its row scan filtered by the participant SELECT policy, which a
  // no-actor sweep cannot satisfy. The definer bypasses that (NO FORCE) and only
  // ever removes already-expired rows.
  return withTenant(tenantId, async (tx) => {
    const [row] = [...(await tx.execute(sql`select auth_msg_expire(${tenantId}) as n`))] as {
      n: number;
    }[];
    return { deleted: row?.n ?? 0 };
  });
}
