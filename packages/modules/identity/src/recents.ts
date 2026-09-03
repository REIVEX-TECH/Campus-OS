import { and, desc, eq, sql } from 'drizzle-orm';
import { withActor } from '@campusos/db';
import { userRecents } from './schema/identity';

/**
 * What a person viewed recently, so a page can take them straight back.
 *
 * Own rows only, read and written as the person themselves. The entries are
 * deliberately generic (a kind, a key, a label, a relative href) so this knows
 * nothing about timetables and any module can record into it without the
 * identity module learning what the module is. The list is bounded per tenant;
 * the newest entry for a key wins.
 */

export const RECENT_KINDS = ['section', 'teacher', 'room'] as const;
export type RecentKind = (typeof RECENT_KINDS)[number];

export interface RecentItem {
  kind: RecentKind;
  key: string;
  label: string;
  /** Relative path only. Never an absolute URL. */
  href: string;
  viewedAt: Date;
}

/** How many a person keeps per tenant. Older ones fall off the end. */
export const RECENTS_KEPT = 20;

export async function recordRecent(
  userId: string,
  tenantId: string,
  item: Omit<RecentItem, 'viewedAt'>,
): Promise<void> {
  await withActor(userId, async (tx) => {
    const now = new Date();
    await tx
      .insert(userRecents)
      .values({ userId, tenantId, ...item, viewedAt: now })
      .onConflictDoUpdate({
        target: [userRecents.userId, userRecents.tenantId, userRecents.kind, userRecents.key],
        set: { label: item.label, href: item.href, viewedAt: now },
      });
    // Keep the list bounded. Everything past the newest RECENTS_KEPT goes.
    await tx.execute(sql`
      delete from user_recents
      where user_id = ${userId}::uuid and tenant_id = ${tenantId}
        and id not in (
          select id from user_recents
          where user_id = ${userId}::uuid and tenant_id = ${tenantId}
          order by viewed_at desc
          limit ${RECENTS_KEPT}
        )`);
  });
}

export async function listRecents(
  userId: string,
  tenantId: string,
  limit = 8,
): Promise<RecentItem[]> {
  const rows = await withActor(userId, (tx) =>
    tx
      .select()
      .from(userRecents)
      .where(and(eq(userRecents.userId, userId), eq(userRecents.tenantId, tenantId)))
      .orderBy(desc(userRecents.viewedAt))
      .limit(limit),
  );
  return rows.map((r) => ({
    kind: r.kind as RecentKind,
    key: r.key,
    label: r.label,
    href: r.href,
    viewedAt: r.viewedAt,
  }));
}

/** Forget everything viewed in one tenant. Theirs to clear, on a shared device. */
export async function clearRecents(userId: string, tenantId: string): Promise<void> {
  await withActor(userId, (tx) =>
    tx
      .delete(userRecents)
      .where(and(eq(userRecents.userId, userId), eq(userRecents.tenantId, tenantId))),
  );
}
