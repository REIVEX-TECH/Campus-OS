import { describe, expect, it } from 'vitest';
import {
  chipsForStudent,
  courseCodesOf,
  freeWindowToday,
  lostfoundBuildingMatch,
  marketplaceCourseMatch,
  parseHHMM,
  ridesAfterClass,
  type ListingLite,
  type LostFoundLite,
  type RideOfferLite,
  type ScheduleClass,
} from '@/lib/chips/signals';

const cls = (over: Partial<ScheduleClass>): ScheduleClass => ({
  startsAt: '09:00',
  endsAt: '10:00',
  courseCode: 'CS101',
  courseTitle: 'Intro to Programming',
  buildingName: 'Main Block',
  ...over,
});

describe('parseHHMM', () => {
  it('parses valid times and rejects junk', () => {
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseHHMM('9:05')).toBe(545);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('bad')).toBeNull();
  });
});

describe('courseCodesOf', () => {
  it('normalises the schema code and any code in the title', () => {
    expect(courseCodesOf(cls({ courseCode: 'cs-101', courseTitle: 'Also MATH 203 lab' }))).toEqual(
      expect.arrayContaining(['CS101', 'MATH203']),
    );
  });
});

describe('marketplace-course-match', () => {
  const listings: ListingLite[] = [
    { id: 'l1', title: 'CS-101 textbook, great condition', pricePaisa: 150000, createdAt: 100 },
    { id: 'l2', title: 'Bike for sale', pricePaisa: 900000, createdAt: 200 },
    { id: 'l3', title: 'cs101 notes bundle', pricePaisa: 50000, createdAt: 300 },
  ];
  it('matches a course code in a listing title, newest first', () => {
    const c = marketplaceCourseMatch([cls({})], listings);
    expect(c?.kind).toBe('marketplace-course-match');
    expect(c && 'listingId' in c && c.listingId).toBe('l3'); // newest of the two CS101 matches
  });
  it('returns null when no listing matches a code', () => {
    expect(marketplaceCourseMatch([cls({ courseCode: 'BIO999' })], listings)).toBeNull();
  });
  it('returns null with no schedule', () => {
    expect(marketplaceCourseMatch([], listings)).toBeNull();
  });
});

describe('lostfound-building-match', () => {
  const items: LostFoundLite[] = [
    { id: 'i1', buildingName: 'Main Block', createdAt: 10 },
    { id: 'i2', buildingName: 'Main Block', createdAt: 30 },
    { id: 'i3', buildingName: 'Library', createdAt: 20 },
  ];
  it('counts items in today buildings and picks the top building', () => {
    const c = lostfoundBuildingMatch([cls({ buildingName: 'Main Block' })], items);
    expect(c && c.kind === 'lostfound-building-match' && c.count).toBe(2);
    expect(c && c.kind === 'lostfound-building-match' && c.building).toBe('Main Block');
  });
  it('returns null when no items are in today buildings', () => {
    expect(lostfoundBuildingMatch([cls({ buildingName: 'Sports Complex' })], items)).toBeNull();
  });
  it('returns null when the schedule has no buildings', () => {
    expect(lostfoundBuildingMatch([cls({ buildingName: null })], items)).toBeNull();
  });
});

describe('rides-after-class', () => {
  const end = Date.UTC(2026, 8, 23, 11, 0); // 11:00
  const at = (h: number, m: number) => Date.UTC(2026, 8, 23, h, m);
  it('fires at >= 2 offers inside the 3h window', () => {
    const offers: RideOfferLite[] = [
      { id: 'r1', departAt: at(11, 30) },
      { id: 'r2', departAt: at(13, 0) },
      { id: 'r3', departAt: at(15, 30) }, // outside 11:00-14:00 window
    ];
    const c = ridesAfterClass(end, offers);
    expect(c && c.kind === 'rides-after-class' && c.count).toBe(2);
    expect(c && c.kind === 'rides-after-class' && c.earliestDepartAt).toBe(at(11, 30));
  });
  it('returns null with fewer than 2 in window, or no class end', () => {
    expect(ridesAfterClass(end, [{ id: 'r1', departAt: at(11, 30) }])).toBeNull();
    expect(ridesAfterClass(null, [{ id: 'r1', departAt: at(11, 30) }])).toBeNull();
  });
});

describe('free-window-today', () => {
  it('finds a >= 2h gap ending before 18:00', () => {
    const c = freeWindowToday([
      cls({ startsAt: '09:00', endsAt: '10:00' }),
      cls({ startsAt: '13:00', endsAt: '14:00' }), // 3h gap 10:00-13:00
    ]);
    expect(c && c.kind === 'free-window-today' && c.startMinutes).toBe(600);
    expect(c && c.kind === 'free-window-today' && c.endMinutes).toBe(780);
  });
  it('rejects a gap that is < 2h or ends after 18:00', () => {
    expect(
      freeWindowToday([cls({ endsAt: '10:00' }), cls({ startsAt: '11:00', endsAt: '12:00' })]),
    ).toBeNull(); // 1h gap
    expect(
      freeWindowToday([cls({ endsAt: '16:00' }), cls({ startsAt: '19:00', endsAt: '20:00' })]),
    ).toBeNull(); // gap ends at 19:00
  });
});

describe('chipsForStudent ranking', () => {
  const base = {
    schedule: [cls({})],
    listings: [{ id: 'l1', title: 'CS101 book', pricePaisa: 1000, createdAt: 1 }] as ListingLite[],
    lostFound: [{ id: 'i1', buildingName: 'Main Block', createdAt: 1 }] as LostFoundLite[],
    rideOffers: [] as RideOfferLite[],
    lastClassEndAt: null as number | null,
    dismissedKinds: new Set<string>(),
  };
  it('prefers marketplace over lost-found when both fire', () => {
    expect(chipsForStudent(base)?.kind).toBe('marketplace-course-match');
  });
  it('falls through to the next kind when the top one is dismissed', () => {
    expect(
      chipsForStudent({ ...base, dismissedKinds: new Set(['marketplace-course-match']) })?.kind,
    ).toBe('lostfound-building-match');
  });
  it('shows nothing with no classes today', () => {
    expect(chipsForStudent({ ...base, schedule: [] })).toBeNull();
  });
  it('shows nothing when every candidate kind is dismissed', () => {
    const dismissed = new Set(['marketplace-course-match', 'lostfound-building-match']);
    // free-window needs 2 classes; only marketplace+lostfound fire here, both dismissed.
    expect(chipsForStudent({ ...base, dismissedKinds: dismissed })).toBeNull();
  });
});
