import { describe, expect, it } from 'vitest';
import {
  canChangeHandle,
  generateHandle,
  HANDLE_PATTERN,
  nextChangeAllowedAt,
  reservedUntil,
  validateHandleShape,
} from '../src/handles/handle';
import { ADJECTIVES, NOUNS, RESERVED_EXACT, RESERVED_SUBSTRINGS } from '../src/handles/words';

describe('generateHandle', () => {
  it('always has the Adjective_Noun_1234 shape', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateHandle()).toMatch(HANDLE_PATTERN);
    }
  });

  it('only ever uses the curated vocabulary', () => {
    for (let i = 0; i < 200; i += 1) {
      const [adjective, noun, number] = generateHandle().split('_');
      expect(ADJECTIVES).toContain(adjective);
      expect(NOUNS).toContain(noun);
      // Four digits, never a leading zero, so no handle reads like a serial.
      expect(Number(number)).toBeGreaterThanOrEqual(1000);
      expect(Number(number)).toBeLessThanOrEqual(9999);
    }
  });

  it('varies, so handles are not effectively sequential', () => {
    const seen = new Set(Array.from({ length: 200 }, generateHandle));
    expect(seen.size).toBeGreaterThan(150);
  });

  it('never generates something it would then refuse', () => {
    // A generator that can produce a reserved handle would hand someone a name
    // they are not allowed to keep.
    for (let i = 0; i < 300; i += 1) {
      expect(validateHandleShape(generateHandle())).toBeNull();
    }
  });
});

describe('the vocabulary', () => {
  it('is large enough that collisions stay rare', () => {
    expect(ADJECTIVES.length * NOUNS.length * 9000).toBeGreaterThan(100_000_000);
  });

  it('has no duplicates, which would skew the distribution', () => {
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    expect(new Set(NOUNS).size).toBe(NOUNS.length);
  });

  it('contains no reserved word, so the generator cannot borrow authority', () => {
    for (const word of [...ADJECTIVES, ...NOUNS]) {
      const lowered = word.toLowerCase();
      expect(RESERVED_SUBSTRINGS.some((r) => lowered.includes(r))).toBe(false);
      expect(RESERVED_EXACT).not.toContain(lowered);
    }
  });
});

describe('validateHandleShape', () => {
  it('accepts a reasonable chosen handle', () => {
    expect(validateHandleShape('Quiet_Heron_42')).toBeNull();
    expect(validateHandleShape('quietheron')).toBeNull();
  });

  it('rejects shapes that are too short, too long, or oddly punctuated', () => {
    expect(validateHandleShape('ab')).toBe('format');
    expect(validateHandleShape('x'.repeat(30))).toBe('format');
    expect(validateHandleShape('has spaces')).toBe('format');
    expect(validateHandleShape('has-a-dash')).toBe('format');
    expect(validateHandleShape('1starts_with_digit')).toBe('format');
  });

  it('refuses anything that borrows staff authority, including as a substring', () => {
    expect(validateHandleShape('admin')).toBe('reserved');
    expect(validateHandleShape('Campusos_Team')).toBe('reserved');
    expect(validateHandleShape('the_moderator_1')).toBe('reserved');
    expect(validateHandleShape('SuperAdmin99')).toBe('reserved');
    expect(validateHandleShape('the_mod_1')).toBe('reserved');
  });

  it('does not punish ordinary words that merely contain a short reserved one', () => {
    // "Modest" holds "mod" and "Stream" holds "team"; neither claims anything.
    expect(validateHandleShape('Modest_Otter_12')).toBeNull();
    expect(validateHandleShape('Stream_Finch_88')).toBeNull();
  });
});

describe('the change cooldown', () => {
  it('lets a user who has never changed their handle change it', () => {
    expect(canChangeHandle(null)).toBe(true);
    expect(nextChangeAllowedAt(null)).toBeNull();
  });

  it('refuses a second change inside the window', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(canChangeHandle(yesterday)).toBe(false);
  });

  it('allows it again once the window has passed', () => {
    const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    expect(canChangeHandle(longAgo)).toBe(true);
  });
});

describe('reservedUntil', () => {
  it('holds a released handle long enough that it cannot be used to impersonate', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(reservedUntil(now).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});
