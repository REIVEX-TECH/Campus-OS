import { describe, expect, it } from 'vitest';
import { applyVote, controversyScore, hotScore, wilsonLowerBound } from '../src/domain/ranking';

describe('hotScore', () => {
  const t0 = new Date('2026-09-01T00:00:00Z');
  const later = new Date(t0.getTime() + 12.5 * 3600 * 1000);

  it('ranks ten votes level with twelve and a half hours of age', () => {
    expect(hotScore(10, 0, t0)).toBeCloseTo(hotScore(1, 0, later), 3);
  });

  it('treats zero and one net vote alike, and a negative score as older', () => {
    expect(hotScore(0, 0, t0)).toBe(hotScore(1, 0, t0));
    expect(hotScore(0, 10, t0)).toBeLessThan(hotScore(0, 0, t0));
  });

  it('prefers newer at equal score', () => {
    expect(hotScore(5, 0, later)).toBeGreaterThan(hotScore(5, 0, t0));
  });
});

describe('controversyScore', () => {
  it('is zero unless both sides voted', () => {
    expect(controversyScore(10, 0)).toBe(0);
    expect(controversyScore(0, 10)).toBe(0);
  });

  it('rates an even split on many votes highest', () => {
    expect(controversyScore(50, 50)).toBeGreaterThan(controversyScore(90, 10));
    expect(controversyScore(50, 50)).toBeGreaterThan(controversyScore(5, 5));
  });
});

describe('wilsonLowerBound', () => {
  it('does not let three clean votes beat sixty against ten', () => {
    expect(wilsonLowerBound(60, 10)).toBeGreaterThan(wilsonLowerBound(3, 0));
  });

  it('is zero with no votes and rises with agreement', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(10, 0)).toBeGreaterThan(wilsonLowerBound(5, 5));
  });
});

describe('applyVote', () => {
  it('moves a person between up, down and none without double counting', () => {
    const start = { upVotes: 2, downVotes: 1 };
    expect(applyVote(start, 0, 1)).toEqual({ upVotes: 3, downVotes: 1, score: 2 });
    expect(applyVote(start, 1, -1)).toEqual({ upVotes: 1, downVotes: 2, score: -1 });
    expect(applyVote(start, -1, 0)).toEqual({ upVotes: 2, downVotes: 0, score: 2 });
    expect(applyVote(start, 1, 1)).toEqual({ upVotes: 2, downVotes: 1, score: 1 });
  });
});
