import type { MessageKey } from '@/lib/i18n';
import type { ModuleIconName } from '@/lib/modules';

/**
 * Contextual home cards: small, dismissible nudges on the tenant home that point at
 * a module worth a first action. They are visually distinct from posts and content,
 * and ranked by a simple time-decayed relevance with no personalization (we have no
 * per-user signal yet, so the same order is shown to everyone). A card is gated on its
 * module being enabled for the tenant, hidden for 24h once the person dismisses it
 * (see @campusos/module-identity/cards), and at most a handful show at once.
 *
 * Relevance = weight x 2^(-ageDays / HALF_LIFE_DAYS), where age is measured from the
 * card's `since` date. Decay sets the order among the enabled, undismissed cards; it
 * does not hide a card on its own (dismissal and the top-N cap do that), so an
 * onboarding nudge keeps its place until the person acts on it or dismisses it.
 */

export const HALF_LIFE_DAYS = 30;
export const DEFAULT_CARD_LIMIT = 2;

export interface ContextualCardDef {
  /** Stable, opaque id; the dismissal store keys on it. Never reused for another card. */
  id: string;
  /** The tenant `enabledModules` slug this card needs (kebab, e.g. "lost-found"). */
  module: string;
  /** Path under the tenant base the CTA links to (no leading slash), e.g. "rides". */
  path: string;
  /** When this card became relevant, for the time decay. ISO date. */
  since: string;
  /** Base importance before decay. */
  weight: number;
  icon: ModuleIconName;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  ctaKey: MessageKey;
}

/**
 * The catalog. Add a card by appending one entry with a fresh `id` and a `since` of
 * the day it goes live; never renumber or reuse an id (a reused id would inherit an
 * unrelated card's dismissals). Ids are the contract with the dismissal store.
 */
export const CONTEXTUAL_CARDS: readonly ContextualCardDef[] = [
  {
    id: 'rides-intro',
    module: 'rides',
    path: 'rides',
    since: '2026-08-01',
    weight: 1,
    icon: 'car',
    titleKey: 'cards.rides.title',
    bodyKey: 'cards.rides.body',
    ctaKey: 'cards.rides.cta',
  },
  {
    id: 'messages-intro',
    module: 'messages',
    path: 'messages',
    since: '2026-07-01',
    weight: 0.8,
    icon: 'mail',
    titleKey: 'cards.messages.title',
    bodyKey: 'cards.messages.body',
    ctaKey: 'cards.messages.cta',
  },
  {
    id: 'marketplace-intro',
    module: 'marketplace',
    path: 'marketplace',
    since: '2026-06-01',
    weight: 0.9,
    icon: 'shopping-bag',
    titleKey: 'cards.marketplace.title',
    bodyKey: 'cards.marketplace.body',
    ctaKey: 'cards.marketplace.cta',
  },
  {
    id: 'lost-found-intro',
    module: 'lost-found',
    path: 'lost-found',
    since: '2026-05-01',
    weight: 0.85,
    icon: 'package-search',
    titleKey: 'cards.lostFound.title',
    bodyKey: 'cards.lostFound.body',
    ctaKey: 'cards.lostFound.cta',
  },
  {
    id: 'communities-intro',
    module: 'communities',
    path: 'c',
    since: '2026-04-01',
    weight: 0.85,
    icon: 'message-circle',
    titleKey: 'cards.communities.title',
    bodyKey: 'cards.communities.body',
    ctaKey: 'cards.communities.cta',
  },
];

/** Time-decayed relevance of a card at `now`. Higher is more relevant. */
export function cardScore(card: ContextualCardDef, now: Date): number {
  const ageMs = now.getTime() - new Date(card.since).getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);
  return card.weight * Math.pow(2, -ageDays / HALF_LIFE_DAYS);
}

/**
 * The cards to show: those whose module is enabled and that are not currently
 * dismissed, most relevant first, capped at `limit`. Pure, so it is unit-tested
 * directly with a fixed `now`.
 */
export function selectContextualCards(opts: {
  enabledModules: readonly string[];
  dismissedIds: ReadonlySet<string>;
  now: Date;
  limit?: number;
}): ContextualCardDef[] {
  const enabled = new Set(opts.enabledModules);
  return CONTEXTUAL_CARDS.filter((c) => enabled.has(c.module) && !opts.dismissedIds.has(c.id))
    .map((c) => ({ card: c, score: cardScore(c, opts.now) }))
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
    .slice(0, opts.limit ?? DEFAULT_CARD_LIMIT)
    .map((x) => x.card);
}
