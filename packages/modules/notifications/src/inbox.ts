import { sql } from 'drizzle-orm';
import { withActorInTenant } from '@campusos/db';

/**
 * Reading the inbox. A recipient reads only their own rows (the RESTRICTIVE own-row
 * policy). `unreadCount` counts every unread notification regardless of kind, for
 * the bell. `listGenericInbox` returns the generic (link-bearing) notifications;
 * communities notifications keep their own reader, and apps/web merges the two.
 */

export interface InboxItem {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  link: string | null;
  actorHandle: string | null;
  actorAvatarSeed: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Every unread notification for the viewer, all kinds. The bell count. */
export async function unreadCount(actor: { userId: string }, tenantId: string): Promise<number> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const [row] = [
      ...(await tx.execute(sql`
        select count(*)::int as n from notifications
        where tenant_id = ${tenantId} and user_id = ${actor.userId}::uuid and read_at is null`)),
    ] as { n: number }[];
    return row?.n ?? 0;
  });
}

/** The viewer's generic (non-communities) notifications, newest first. */
export async function listGenericInbox(
  actor: { userId: string },
  tenantId: string,
  limit = 30,
): Promise<InboxItem[]> {
  const capped = Math.min(Math.max(1, limit), 100);
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        select n.id, n.kind, n.payload, n.link, n.read_at, n.created_at,
               p.handle as actor_handle, p.avatar_seed as actor_avatar_seed
        from notifications n
        left join public_profiles p on p.user_id = n.actor_id
        where n.tenant_id = ${tenantId} and n.user_id = ${actor.userId}::uuid
          and n.link is not null
        order by n.created_at desc, n.id desc
        limit ${capped}`)),
    ] as Array<{
      id: string;
      kind: string;
      payload: Record<string, unknown> | null;
      link: string | null;
      read_at: string | Date | null;
      created_at: string | Date;
      actor_handle: string | null;
      actor_avatar_seed: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: r.payload,
      link: r.link,
      actorHandle: r.actor_handle,
      actorAvatarSeed: r.actor_avatar_seed,
      readAt: r.read_at === null ? null : toDate(r.read_at),
      createdAt: toDate(r.created_at),
    }));
  });
}

/** Mark some, or all, of the viewer's notifications read (any kind). Own rows only. */
export async function markRead(
  actor: { userId: string },
  tenantId: string,
  ids: string[] | 'all',
): Promise<{ marked: number }> {
  if (ids !== 'all' && ids.length === 0) return { marked: 0 };
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const rows = [
      ...(await tx.execute(sql`
        update notifications set read_at = now()
        where tenant_id = ${tenantId} and user_id = ${actor.userId}::uuid and read_at is null
          ${
            ids === 'all'
              ? sql``
              : sql`and id in (${sql.join(
                  ids.map((i) => sql`${i}::uuid`),
                  sql`, `,
                )})`
          }
        returning id`)),
    ];
    return { marked: rows.length };
  });
}
