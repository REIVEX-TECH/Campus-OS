import { describe, expect, it } from 'vitest';
import { canReplyAt, childPath, depthOf, isWithin } from '../src/domain/paths';
import { communitySlugFromName } from '../src/domain/slug';

describe('comment paths', () => {
  it('builds dotted paths and counts depth from them', () => {
    const root = childPath(null, 'a');
    const reply = childPath(root, 'b');
    const deeper = childPath(reply, 'c');
    expect(root).toBe('a');
    expect(deeper).toBe('a.b.c');
    expect(depthOf(root)).toBe(0);
    expect(depthOf(deeper)).toBe(2);
  });

  it('caps replies at the tenant depth', () => {
    expect(canReplyAt(6, 8)).toBe(true);
    expect(canReplyAt(7, 8)).toBe(true);
    expect(canReplyAt(8, 8)).toBe(false);
  });

  it('knows a subtree from a sibling with a shared prefix', () => {
    expect(isWithin('a.b', 'a.b.c')).toBe(true);
    expect(isWithin('a.b', 'a.b')).toBe(true);
    expect(isWithin('a.b', 'a.bc')).toBe(false);
  });
});

describe('communitySlugFromName', () => {
  it('derives a slug and refuses what cannot be one', () => {
    expect(communitySlugFromName('CS Freshers 2026')).toBe('cs-freshers-2026');
    expect(communitySlugFromName('  Lost & Found  ')).toBe('lost-found');
    expect(communitySlugFromName('!!')).toBeNull();
    expect(communitySlugFromName('ab')).toBeNull();
  });
});
