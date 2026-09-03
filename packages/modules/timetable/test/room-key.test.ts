import { describe, expect, it } from 'vitest';
import { inferBuildingCode, roomDedupKey, roomDisplayName } from '../src/domain/room-key';

describe('roomDedupKey', () => {
  it('collapses case, whitespace, and separator variants to one key', () => {
    expect(roomDedupKey('Kitchen Lab')).toBe('kitchen-lab');
    expect(roomDedupKey('kitchen lab ')).toBe('kitchen-lab');
    expect(roomDedupKey('  Kitchen   Lab  ')).toBe('kitchen-lab');
    expect(roomDedupKey('Lab 15 NB')).toBe('lab-15-nb');
    expect(roomDedupKey('LAB-15-NB')).toBe('lab-15-nb');
    // the example pairs from the requirement each collapse to a single key:
    expect(roomDedupKey('Kitchen Lab')).toBe(roomDedupKey('kitchen lab '));
    expect(roomDedupKey('Lab 15 NB')).toBe(roomDedupKey('LAB-15-NB'));
  });

  it('keeps genuinely different rooms distinct', () => {
    expect(roomDedupKey('Lab 15')).not.toBe(roomDedupKey('Lab 15 NB'));
    expect(roomDedupKey('Room 25')).not.toBe(roomDedupKey('Room 26'));
  });

  it('returns empty for blank or punctuation-only input (the TBA safety valve)', () => {
    expect(roomDedupKey('')).toBe('');
    expect(roomDedupKey('   ')).toBe('');
    expect(roomDedupKey(' - / ')).toBe('');
  });

  it('preserves non-ASCII letters and numbers rather than stripping to empty', () => {
    expect(roomDedupKey('Sala Ñ 3')).toBe('sala-ñ-3');
  });
});

describe('roomDisplayName', () => {
  it('trims and collapses internal whitespace, preserving case and punctuation', () => {
    expect(roomDisplayName('  Lab 15   NB ')).toBe('Lab 15 NB');
    expect(roomDisplayName('LAB-15-NB')).toBe('LAB-15-NB');
    expect(roomDisplayName('Kitchen Lab')).toBe('Kitchen Lab');
  });
});

describe('inferBuildingCode', () => {
  it('reads a trailing two or three letter block code', () => {
    expect(inferBuildingCode('Lab 15 NB')).toBe('NB');
    expect(inferBuildingCode('Lab 18 OB')).toBe('OB');
    expect(inferBuildingCode('Room 25  NB ')).toBe('NB');
    expect(inferBuildingCode('Seminar Hall ABC')).toBe('ABC');
  });

  it('keeps the safety valve: no recognisable suffix means no building', () => {
    expect(inferBuildingCode('Kitchen Lab')).toBeNull();
    expect(inferBuildingCode('Room 101')).toBeNull();
    expect(inferBuildingCode('Lab 15 nb')).toBeNull();
    expect(inferBuildingCode('Auditorium A')).toBeNull();
    expect(inferBuildingCode('NB')).toBeNull();
    expect(inferBuildingCode('')).toBeNull();
  });
});
