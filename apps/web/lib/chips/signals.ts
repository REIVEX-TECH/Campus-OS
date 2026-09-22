/**
 * The timetable chip signal engine: pure, deterministic candidate functions over
 * already-fetched data (see docs/design-timetable-chips.md). No I/O, no writes, no clock
 * of its own; `now`/`nowMinutes` are passed in so the whole engine is unit-tested against
 * fixtures. The caller (the app layer) does the fetching and the tenant-timezone
 * conversions and feeds the results here. The chip copy is built in the UI from the
 * structured candidate fields, so nothing here formats text.
 */

export const CHIP_KINDS = [
  'marketplace-course-match',
  'lostfound-building-match',
  'rides-after-class',
  'free-window-today',
] as const;
export type ChipKind = (typeof CHIP_KINDS)[number];

// Rank: rarer/more-specific first. A total order over kinds, so cross-kind ties never
// arise; `recency` is a within-kind tiebreak kept for when a kind yields more than one.
const RANK: Record<ChipKind, number> = {
  'marketplace-course-match': 0,
  'lostfound-building-match': 1,
  'rides-after-class': 2,
  'free-window-today': 3,
};

/** One of today's classes for the section in view, in tenant wall-clock. */
export interface ScheduleClass {
  /** 'HH:MM' local wall-clock. */
  startsAt: string;
  endsAt: string;
  courseCode: string;
  courseTitle: string;
  buildingName: string | null;
}

export interface ListingLite {
  id: string;
  title: string;
  pricePaisa: number;
  /** ms since epoch, for the recency tiebreak. */
  createdAt: number;
}

export interface LostFoundLite {
  id: string;
  buildingName: string;
  createdAt: number;
}

export interface RideOfferLite {
  id: string;
  /** ms since epoch. */
  departAt: number;
}

export type ChipCandidate =
  | {
      kind: 'marketplace-course-match';
      recency: number;
      listingId: string;
      title: string;
      pricePaisa: number;
      courseCode: string;
    }
  | { kind: 'lostfound-building-match'; recency: number; building: string; count: number }
  | { kind: 'rides-after-class'; recency: number; count: number; earliestDepartAt: number }
  | { kind: 'free-window-today'; recency: number; startMinutes: number; endMinutes: number };

/** 'HH:MM' -> minutes since midnight, or null if malformed. */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const COURSE_CODE = /\b[A-Z]{2,4}[- ]?\d{3,4}\b/g;

/** Course codes from a class: the schema `courseCode` plus any found in the title. */
export function courseCodesOf(cls: ScheduleClass): string[] {
  const codes = new Set<string>();
  if (cls.courseCode) codes.add(normalizeCode(cls.courseCode));
  for (const raw of cls.courseTitle.toUpperCase().match(COURSE_CODE) ?? []) {
    codes.add(normalizeCode(raw));
  }
  return [...codes].filter(Boolean);
}

/** Uppercase, strip separators: "cs-101" and "CS 101" both become "CS101". */
function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Active listing whose title contains a course code from today, most recent first. */
export function marketplaceCourseMatch(
  schedule: ScheduleClass[],
  listings: ListingLite[],
): ChipCandidate | null {
  const codes = [...new Set(schedule.flatMap(courseCodesOf))];
  if (codes.length === 0) return null;
  const matches: { listing: ListingLite; code: string }[] = [];
  for (const listing of listings) {
    const title = normalizeCode(listing.title);
    const code = codes.find((c) => title.includes(c));
    if (code) matches.push({ listing, code });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.listing.createdAt - a.listing.createdAt);
  const top = matches[0]!;
  return {
    kind: 'marketplace-course-match',
    recency: top.listing.createdAt,
    listingId: top.listing.id,
    title: top.listing.title,
    pricePaisa: top.listing.pricePaisa,
    courseCode: top.code,
  };
}

/** L&F items (already last-7-days, active) in today's buildings: top building by count. */
export function lostfoundBuildingMatch(
  schedule: ScheduleClass[],
  items: LostFoundLite[],
): ChipCandidate | null {
  const buildings = new Set(
    schedule.map((c) => c.buildingName).filter((b): b is string => Boolean(b)),
  );
  if (buildings.size === 0) return null;
  const byBuilding = new Map<string, { count: number; recency: number }>();
  for (const item of items) {
    if (!buildings.has(item.buildingName)) continue;
    const cur = byBuilding.get(item.buildingName) ?? { count: 0, recency: 0 };
    byBuilding.set(item.buildingName, {
      count: cur.count + 1,
      recency: Math.max(cur.recency, item.createdAt),
    });
  }
  if (byBuilding.size === 0) return null;
  // Most items, then most recent.
  const [building, agg] = [...byBuilding.entries()].sort(
    (a, b) => b[1].count - a[1].count || b[1].recency - a[1].recency,
  )[0]!;
  return { kind: 'lostfound-building-match', recency: agg.recency, building, count: agg.count };
}

/**
 * Ride offers departing in [lastClassEnd, lastClassEnd + 3h]; fires at >= 2. Offers are
 * pre-filtered by the caller to a campus endpoint. `lastClassEndAt` is the tenant-resolved
 * absolute instant of the last class end today, or null when there are no classes.
 */
export function ridesAfterClass(
  lastClassEndAt: number | null,
  rideOffers: RideOfferLite[],
): ChipCandidate | null {
  if (lastClassEndAt === null) return null;
  const windowEnd = lastClassEndAt + 3 * 60 * 60 * 1000;
  const inWindow = rideOffers
    .filter((r) => r.departAt >= lastClassEndAt && r.departAt <= windowEnd)
    .sort((a, b) => a.departAt - b.departAt);
  if (inWindow.length < 2) return null;
  return {
    kind: 'rides-after-class',
    recency: inWindow[0]!.departAt,
    count: inWindow.length,
    earliestDepartAt: inWindow[0]!.departAt,
  };
}

const SIX_PM = 18 * 60;

/** Largest gap between consecutive classes >= 2h and ending by 18:00, or null. */
export function freeWindowToday(schedule: ScheduleClass[]): ChipCandidate | null {
  const spans = schedule
    .map((c) => ({ start: parseHHMM(c.startsAt), end: parseHHMM(c.endsAt) }))
    .filter((s): s is { start: number; end: number } => s.start !== null && s.end !== null)
    .sort((a, b) => a.start - b.start);
  if (spans.length < 2) return null;
  let best: { start: number; end: number } | null = null;
  for (let i = 0; i < spans.length - 1; i += 1) {
    const gapStart = spans[i]!.end;
    const gapEnd = spans[i + 1]!.start;
    if (gapEnd - gapStart >= 120 && gapEnd <= SIX_PM) {
      if (!best || gapEnd - gapStart > best.end - best.start)
        best = { start: gapStart, end: gapEnd };
    }
  }
  if (!best) return null;
  return { kind: 'free-window-today', recency: 0, startMinutes: best.start, endMinutes: best.end };
}

/** Everything the engine needs, already fetched by the caller. */
export interface ChipContext {
  schedule: ScheduleClass[];
  listings: ListingLite[];
  lostFound: LostFoundLite[];
  rideOffers: RideOfferLite[];
  lastClassEndAt: number | null;
  dismissedKinds: ReadonlySet<string>;
}

/**
 * The single chip to show: the highest-ranked candidate whose kind is not dismissed
 * today, or null. No classes today -> no candidates -> no chip.
 */
export function chipsForStudent(ctx: ChipContext): ChipCandidate | null {
  if (ctx.schedule.length === 0) return null;
  const candidates = [
    marketplaceCourseMatch(ctx.schedule, ctx.listings),
    lostfoundBuildingMatch(ctx.schedule, ctx.lostFound),
    ridesAfterClass(ctx.lastClassEndAt, ctx.rideOffers),
    freeWindowToday(ctx.schedule),
  ].filter((c): c is ChipCandidate => c !== null && !ctx.dismissedKinds.has(c.kind));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.recency - a.recency);
  return candidates[0]!;
}
