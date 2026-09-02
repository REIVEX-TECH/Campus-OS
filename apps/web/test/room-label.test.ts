import { describe, expect, it } from 'vitest';
import { roomInitials } from '@/lib/room-label';

describe('roomInitials', () => {
  it('leads with the room number, which is what people say', () => {
    expect(roomInitials('Room 26 NB')).toBe('26');
    expect(roomInitials('Lab 18 OB')).toBe('18');
    expect(roomInitials('R-101')).toBe('101');
  });

  it('falls back to letters when a room has no number', () => {
    expect(roomInitials('Auditorium')).toBe('AU');
    expect(roomInitials('Main Hall')).toBe('MA');
  });

  it('never returns an empty mark', () => {
    expect(roomInitials('')).toBe('?');
    expect(roomInitials('---')).toBe('?');
  });

  it('keeps long numbers readable', () => {
    expect(roomInitials('Room 123456')).toBe('123');
  });
});
