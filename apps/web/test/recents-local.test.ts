import { describe, expect, it } from 'vitest';
import { LOCAL_RECENTS_KEPT, mergeRecents, type RecentEntry } from '@/lib/recents-local';

const entry = (key: string, viewedAt: number, label = key): RecentEntry => ({
  kind: 'section',
  key,
  label,
  href: `/u/lgu/timetable?section=${key}`,
  viewedAt,
});

describe('mergeRecents', () => {
  it('orders newest first across every source', () => {
    const merged = mergeRecents([entry('a', 1), entry('b', 3)], [entry('c', 2)]);
    expect(merged.map((e) => e.key)).toEqual(['b', 'c', 'a']);
  });

  it('keeps one entry per kind and key, the newest', () => {
    const merged = mergeRecents([entry('a', 1, 'old')], [entry('a', 5, 'new')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.label).toBe('new');
  });

  it('treats the same key under a different kind as a different thing', () => {
    const merged = mergeRecents([entry('x', 1)], [{ ...entry('x', 2), kind: 'room' }]);
    expect(merged).toHaveLength(2);
  });

  it('never grows past the cap', () => {
    const many = Array.from({ length: LOCAL_RECENTS_KEPT + 10 }, (_, i) => entry(`k${i}`, i));
    expect(mergeRecents(many)).toHaveLength(LOCAL_RECENTS_KEPT);
    // And what it drops is the oldest.
    expect(mergeRecents(many)[0]!.key).toBe(`k${LOCAL_RECENTS_KEPT + 9}`);
  });
});
