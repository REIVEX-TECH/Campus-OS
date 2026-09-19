import { and, eq, gt } from 'drizzle-orm';
import { withActor } from '@campusos/db';
import { cardDismissals } from './schema/identity';

/**
 * Dismissing contextual home cards, per account (0036).
 *
 * A card dismissed once does not return for a window (default 24h). The store is the
 * person's own low-stakes preference, keyed on app.user_id by RLS: theirs to set,
 * theirs to read, nobody else's. `card_id` is opaque here; the web app owns the
 * catalog and only ever passes a card's id in and out.
 */

const DEFAULT_WINDOW_HOURS = 24;

/**
 * Remember that this person dismissed a card in this tenant, now. Idempotent on the
 * (user, tenant, card) key, and a repeat dismissal restarts the window (the point:
 * "no repeat within 24h" is measured from the last dismissal).
 */
export async function dismissCard(userId: string, tenantId: string, cardId: string): Promise<void> {
  await withActor(userId, (tx) =>
    tx
      .insert(cardDismissals)
      .values({ userId, tenantId, cardId })
      .onConflictDoUpdate({
        target: [cardDismissals.userId, cardDismissals.tenantId, cardDismissals.cardId],
        set: { dismissedAt: new Date() },
      }),
  );
}

/**
 * The ids of cards this person has dismissed within the window (default 24h) in this
 * tenant, so the home can hide exactly those and let the rest through.
 */
export async function activeCardDismissals(
  userId: string,
  tenantId: string,
  windowHours = DEFAULT_WINDOW_HOURS,
): Promise<string[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const rows = await withActor(userId, (tx) =>
    tx
      .select({ cardId: cardDismissals.cardId })
      .from(cardDismissals)
      .where(
        and(
          eq(cardDismissals.userId, userId),
          eq(cardDismissals.tenantId, tenantId),
          gt(cardDismissals.dismissedAt, since),
        ),
      ),
  );
  return rows.map((r) => r.cardId);
}
