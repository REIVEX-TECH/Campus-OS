import { and, eq, sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';
import { timetableChipDismissals } from './schema/identity';

/**
 * Dismissing timetable contextual chips, per account per day (0037).
 *
 * A dismissed chip_kind does not reappear until the next day. The write goes through the
 * `record_timetable_chip_dismissal` definer, which stamps the user and tenant from the
 * actor context, so a caller supplies only the chip_kind. The read is an ordinary own-row
 * select scoped to today. `card_id`/`chip_kind` is opaque here; the catalog lives in the
 * web app.
 */

/** Record that this person dismissed a chip kind today. Idempotent. */
export async function dismissTimetableChip(
  userId: string,
  tenantId: string,
  chipKind: string,
): Promise<void> {
  await withActorInTenant(userId, tenantId, (tx) =>
    tx.execute(sql`select record_timetable_chip_dismissal(${chipKind})`),
  );
}

/** The chip kinds this person has dismissed today, so the page hides exactly those. */
export async function dismissedChipKindsToday(userId: string, tenantId: string): Promise<string[]> {
  const rows = await withActorInTenant(userId, tenantId, (tx) =>
    tx
      .select({ chipKind: timetableChipDismissals.chipKind })
      .from(timetableChipDismissals)
      .where(
        and(
          eq(timetableChipDismissals.userId, userId),
          eq(timetableChipDismissals.tenantId, tenantId),
          sql`${timetableChipDismissals.dismissedOn} = current_date`,
        ),
      ),
  );
  return rows.map((r) => r.chipKind);
}
