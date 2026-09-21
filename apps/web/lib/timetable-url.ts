/**
 * The timetable picker's shareable state as a path, not a query string.
 *
 * `/timetable/t/{term}/p/{program}/s/{section}` with prefixed, ordered segments
 * (`t`/`p`/`s`) so the shape is unambiguous: a program needs a term before it, a
 * section needs a program before it. Segments carry ids (the same convention as
 * `/sections/{id}`, `/teachers/{id}`); human names live in titles and metadata. The
 * old `?term&program&section` form is 301'd to this form (see `legacyTimetableRedirect`).
 *
 * These are pure string helpers, unit-tested directly, shared by the picker client,
 * the page metadata, and the middleware redirect so the three cannot drift.
 */

export interface TimetableSelection {
  term?: string;
  program?: string;
  section?: string;
}

/**
 * Build the path form under `basePath` (e.g. `/timetable` or `/u/lgu/timetable`).
 * Ordered: a level is included only when all its parents are present, so a program
 * without a term, or a section without a program, is dropped rather than emitted in an
 * ambiguous position.
 */
export function buildTimetablePath(basePath: string, sel: TimetableSelection): string {
  const segments: string[] = [];
  if (sel.term) {
    segments.push('t', encodeURIComponent(sel.term));
    if (sel.program) {
      segments.push('p', encodeURIComponent(sel.program));
      if (sel.section) segments.push('s', encodeURIComponent(sel.section));
    }
  }
  return segments.length > 0 ? `${basePath}/${segments.join('/')}` : basePath;
}

/**
 * Parse the optional catch-all segments of `/timetable/[[...filters]]` into a
 * selection, or null when the shape is invalid (wrong prefix, wrong order, an empty
 * value, or an odd segment count). `undefined`/empty means the bare picker (`{}`).
 * Next.js has already URL-decoded the segments, so they are used as-is.
 */
export function parseTimetableFilters(filters: string[] | undefined): TimetableSelection | null {
  if (!filters || filters.length === 0) return {};
  if (filters.length % 2 !== 0) return null;
  const expected = ['t', 'p', 's'];
  const sel: TimetableSelection = {};
  for (let i = 0; i < filters.length; i += 2) {
    const prefix = filters[i];
    const value = filters[i + 1];
    if (prefix !== expected[i / 2] || !value) return null;
    if (prefix === 't') sel.term = value;
    else if (prefix === 'p') sel.program = value;
    else sel.section = value;
  }
  return sel;
}

const TIMETABLE_ROOT = /(?:^|\/)timetable$/;

/**
 * Map a legacy `/timetable?term[&program[&section]]` URL to the new path form, for a
 * 301 from middleware, or null when there is nothing to redirect. Works on both the
 * public `/timetable` and the dev `/u/{slug}/timetable` pathnames. Requires `term`;
 * `program`/`section` are carried only alongside their parents, and orphan params
 * (a `program` with no `term`) collapse to the bare picker path.
 */
export function legacyTimetableRedirect(
  pathname: string,
  searchParams: URLSearchParams,
): string | null {
  if (!TIMETABLE_ROOT.test(pathname)) return null;
  const term = searchParams.get('term') ?? undefined;
  const program = searchParams.get('program') ?? undefined;
  const section = searchParams.get('section') ?? undefined;
  if (!term && !program && !section) return null;
  return buildTimetablePath(pathname, { term, program, section });
}
