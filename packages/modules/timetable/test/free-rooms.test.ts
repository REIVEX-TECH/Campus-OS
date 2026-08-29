import { describe, expect, it } from 'vitest';
import { freeRooms, type OccupiedSlot, type TimeWindow } from '../src/domain/free-rooms';

const window: TimeWindow = { dayOfWeek: 1, startsAt: '09:00', endsAt: '10:00' };

describe('freeRooms', () => {
  it('excludes rooms occupied during the window', () => {
    const occupied: OccupiedSlot[] = [
      { roomId: 'r1', dayOfWeek: 1, startsAt: '09:30', endsAt: '10:30' },
    ];
    expect(freeRooms(['r1', 'r2'], occupied, window)).toEqual(['r2']);
  });

  it('ignores occupancy on another day', () => {
    const occupied: OccupiedSlot[] = [
      { roomId: 'r1', dayOfWeek: 2, startsAt: '09:00', endsAt: '10:00' },
    ];
    expect(freeRooms(['r1'], occupied, window)).toEqual(['r1']);
  });

  it('treats an adjacent booking as free', () => {
    const occupied: OccupiedSlot[] = [
      { roomId: 'r1', dayOfWeek: 1, startsAt: '10:00', endsAt: '11:00' },
    ];
    expect(freeRooms(['r1'], occupied, window)).toEqual(['r1']);
  });
});
