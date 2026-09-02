import { describe, expect, it } from 'vitest';
import { countText } from '@/lib/i18n';

describe('countText', () => {
  it('uses the singular for one', () => {
    expect(countText('en', 'classes', 1)).toBe('1 class');
    expect(countText('en', 'courses', 1)).toBe('1 course');
    expect(countText('en', 'days', 1)).toBe('1 day');
  });

  it('uses the plural for anything else', () => {
    expect(countText('en', 'classes', 0)).toBe('0 classes');
    expect(countText('en', 'classes', 4)).toBe('4 classes');
    expect(countText('en', 'days', 5)).toBe('5 days');
  });
});
