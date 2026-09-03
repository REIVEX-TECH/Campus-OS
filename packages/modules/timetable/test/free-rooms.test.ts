import { describe, expect, it } from 'vitest';
import { freeRooms, type OccupiedSlot, type TimeWindow } from '../src/domain/free-rooms';

const at = (startsAt: string, endsAt: string, dayOfWeek = 1): TimeWindow => ({
  dayOfWeek,
  startsAt,
  endsAt,
});

describe('freeRooms', () => {
  // The case that reached production: a Monday 09:30 to 11:00 class in a room
  // that the free-rooms page then listed as free for that exact window.
  const lab15: OccupiedSlot = { roomId: 'lab15', dayOfWeek: 1, startsAt: '09:30', endsAt: '11:00' };
  const rooms = ['lab15', 'lab18'];

  it('is busy for the exact window of the class', () => {
    expect(freeRooms(rooms, [lab15], at('09:30', '11:00'))).toEqual(['lab18']);
  });

  it('is busy for a window inside the class', () => {
    expect(freeRooms(rooms, [lab15], at('10:00', '10:30'))).toEqual(['lab18']);
  });

  it('is busy for a window that overlaps the start of the class', () => {
    expect(freeRooms(rooms, [lab15], at('09:00', '10:00'))).toEqual(['lab18']);
  });

  it('is busy for a window that overlaps the end of the class', () => {
    expect(freeRooms(rooms, [lab15], at('10:30', '12:00'))).toEqual(['lab18']);
  });

  it('is busy for a window that contains the whole class', () => {
    expect(freeRooms(rooms, [lab15], at('09:00', '12:00'))).toEqual(['lab18']);
  });

  it('is free for the window that ends exactly as the class begins', () => {
    expect(freeRooms(rooms, [lab15], at('08:00', '09:30'))).toEqual(['lab15', 'lab18']);
  });

  it('is free for the window that begins exactly as the class ends', () => {
    expect(freeRooms(rooms, [lab15], at('11:00', '12:30'))).toEqual(['lab15', 'lab18']);
  });

  it('accepts the seconds the database appends to a time', () => {
    // Postgres returns a `time` column as HH:MM:SS; the picker sends HH:MM.
    const fromDb: OccupiedSlot = { ...lab15, startsAt: '09:30:00', endsAt: '11:00:00' };
    expect(freeRooms(rooms, [fromDb], at('10:00', '10:30'))).toEqual(['lab18']);
    expect(freeRooms(rooms, [fromDb], at('11:00', '12:00'))).toEqual(['lab15', 'lab18']);
  });

  it('keeps a Monday class on Monday: it does not touch Tuesday, and vice versa', () => {
    const tuesday: OccupiedSlot = { ...lab15, roomId: 'lab18', dayOfWeek: 2 };
    // Monday window: only the Monday class counts.
    expect(freeRooms(rooms, [lab15, tuesday], at('09:30', '11:00', 1))).toEqual(['lab18']);
    // Tuesday window: only the Tuesday class counts.
    expect(freeRooms(rooms, [lab15, tuesday], at('09:30', '11:00', 2))).toEqual(['lab15']);
    // Sunday is ISO 7, never 0.
    expect(freeRooms(rooms, [lab15, tuesday], at('09:30', '11:00', 7))).toEqual(rooms);
  });

  it('counts a room busy when any one of several classes overlaps', () => {
    const early: OccupiedSlot = {
      roomId: 'lab18',
      dayOfWeek: 1,
      startsAt: '08:00',
      endsAt: '09:00',
    };
    const late: OccupiedSlot = {
      roomId: 'lab18',
      dayOfWeek: 1,
      startsAt: '10:45',
      endsAt: '12:00',
    };
    expect(freeRooms(rooms, [early, late], at('09:30', '11:00'))).toEqual(['lab15']);
  });
});
