import { describe, expect, it } from 'vitest';
import { initialsOf, seedColor, seedHash } from '@/app/_components/identity-avatar';

describe('identity avatar', () => {
  it('is deterministic: the same seed always gives the same colour', () => {
    expect(seedHash('teacher-1')).toBe(seedHash('teacher-1'));
    expect(seedColor('teacher-1')).toBe(seedColor('teacher-1'));
  });

  it('separates different seeds', () => {
    expect(seedHash('teacher-1')).not.toBe(seedHash('teacher-2'));
  });

  it('always lands on a palette colour', () => {
    for (const seed of ['a', 'b', 'c', 'room-42', 'Nousheen Ilyas', '']) {
      expect(seedColor(seed)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('derives up to two initials, ignoring punctuation', () => {
    expect(initialsOf('Nousheen Ilyas')).toBe('NI');
    expect(initialsOf('Dr. Rabia Akhtar')).toBe('DR');
    expect(initialsOf('Zahra')).toBe('ZA');
    expect(initialsOf('Lab 18 OB')).toBe('L1');
  });

  it('never returns an empty label', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('!!!')).toBe('?');
  });
});
