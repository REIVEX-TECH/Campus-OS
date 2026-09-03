import { describe, expect, it } from 'vitest';
import { scaleToPercent } from '@/lib/activity-format';

describe('scaleToPercent', () => {
  it('scales to the largest value', () => {
    expect(scaleToPercent([0, 5, 10, 20])).toEqual([0, 25, 50, 100]);
  });

  it('keeps a small value visible as a sliver, and nothing as nothing', () => {
    expect(scaleToPercent([1, 100])).toEqual([4, 100]);
    expect(scaleToPercent([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('handles an empty series', () => {
    expect(scaleToPercent([])).toEqual([]);
  });
});
