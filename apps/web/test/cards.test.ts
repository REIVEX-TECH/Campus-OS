import { describe, expect, it } from 'vitest';
import { CONTEXTUAL_CARDS, HALF_LIFE_DAYS, cardScore, selectContextualCards } from '@/lib/cards';

/**
 * Contextual home cards (docs: A block, run 6). The selection is pure and time-decayed
 * with no personalization, so it is tested directly with a fixed `now`.
 */
describe('contextual cards', () => {
  const now = new Date('2026-09-19T00:00:00Z');
  const byId = (id: string) => CONTEXTUAL_CARDS.find((c) => c.id === id)!;

  it('every card id is unique (ids are the dismissal contract)', () => {
    const ids = CONTEXTUAL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('halves the score after one half-life', () => {
    const card = { ...byId('rides-intro'), since: '2026-01-01', weight: 1 };
    const at = new Date('2026-01-01T00:00:00Z');
    const later = new Date(at.getTime() + HALF_LIFE_DAYS * 86_400_000);
    expect(cardScore(card, later)).toBeCloseTo(cardScore(card, at) / 2, 6);
  });

  it('ranks a more recent card above an older one when shown together', () => {
    // rides (since 2026-08) outranks communities (since 2026-04) at `now`.
    expect(cardScore(byId('rides-intro'), now)).toBeGreaterThan(
      cardScore(byId('communities-intro'), now),
    );
  });

  it('shows only enabled cards, most relevant first, capped at the limit', () => {
    const picked = selectContextualCards({
      enabledModules: ['rides', 'communities', 'messages'],
      dismissedIds: new Set(),
      now,
      limit: 2,
    });
    expect(picked).toHaveLength(2);
    expect(picked[0]!.id).toBe('rides-intro');
    expect(picked.every((c) => ['rides', 'communities', 'messages'].includes(c.module))).toBe(true);
  });

  it('excludes a dismissed card', () => {
    const shown = selectContextualCards({
      enabledModules: ['rides'],
      dismissedIds: new Set(),
      now,
    });
    expect(shown.map((c) => c.id)).toContain('rides-intro');
    const hidden = selectContextualCards({
      enabledModules: ['rides'],
      dismissedIds: new Set(['rides-intro']),
      now,
    });
    expect(hidden).toHaveLength(0);
  });

  it('excludes a card whose module the tenant has not enabled', () => {
    const picked = selectContextualCards({
      enabledModules: ['timetable'],
      dismissedIds: new Set(),
      now,
    });
    expect(picked).toHaveLength(0);
  });
});
