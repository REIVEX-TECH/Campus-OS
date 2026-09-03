import type { TenantTransaction } from '@campusos/db';
import { auditLog } from './schema/identity';

/**
 * Append one line to the audit log, inside the caller's transaction, so the
 * record and the change it describes commit or fail together.
 *
 * The log is append only at the database level (0001): nothing here, or
 * anywhere, can rewrite or erase a line. `meta` carries ids and enum values
 * only; never an email, a name, or anything else that identifies a person.
 */
export async function recordAudit(
  tx: TenantTransaction,
  entry: {
    actorUserId: string | null;
    tenantId: string | null;
    /** Dotted, past tense: `membership.joined`, `membership.verified`. */
    action: string;
    targetType?: string;
    targetId?: string;
    meta?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    tenantId: entry.tenantId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    meta: entry.meta ?? null,
  });
}
