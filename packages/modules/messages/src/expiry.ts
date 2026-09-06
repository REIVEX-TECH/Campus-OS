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
  return withTenant(tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        delete from msg_messages
        where tenant_id = ${tenantId}
          and expires_at is not null
          and expires_at <= now()
        returning id`)),
    ] as { id: string }[];
    return { deleted: rows.length };
  });
}
