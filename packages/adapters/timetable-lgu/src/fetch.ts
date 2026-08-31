import type { AdapterConfig } from './config';
import { FixtureMissingError, PortalBlockedError, type HttpClient } from './http';
import { PORTAL_PATHS, parseOptions, type PortalOption } from './portal';

/** One fetched section timetable, tagged with its full portal coordinates. */
export interface RawSectionTimetable {
  semester: PortalOption;
  degree: PortalOption;
  section: PortalOption;
  html: string;
}

/** A section (or dropdown) that could not be fetched. Never aborts the crawl;
 * surfaced so it can be counted and emitted as an unmapped record. */
export interface CrawlAnomaly {
  stage: 'degrees' | 'sections' | 'timetable';
  semester?: string;
  degree?: string;
  section?: string;
  message: string;
}

export interface RawRecords {
  sections: RawSectionTimetable[];
  anomalies: CrawlAnomaly[];
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function capped<T>(items: T[], limit?: number): T[] {
  return typeof limit === 'number' && limit > 0 ? items.slice(0, limit) : items;
}

/**
 * Crawl the FULL cartesian product the portal exposes: every semester, every
 * degree within it, every section within that, fetching each section's
 * `#table-time`. One bad section (or degree/section dropdown) is logged as an
 * anomaly and skipped, never aborting the whole crawl. A block-like response
 * (PortalBlockedError) DOES abort, so we stop rather than hammer the portal.
 *
 * Optional per-level caps (config.limits) bound the crawl for politeness; when
 * set, the number dropped is reported by the caller (no silent truncation).
 * The same function drives live fetches and fixture replay via the injected
 * client. In fixture mode a not-recorded combo (FixtureMissingError) is skipped
 * silently, so replaying a partial recorded slice yields exactly the recorded
 * combos with no spurious anomalies.
 */
export async function crawl(http: HttpClient, config: AdapterConfig): Promise<RawRecords> {
  const sections: RawSectionTimetable[] = [];
  const anomalies: CrawlAnomaly[] = [];
  const limits = config.limits ?? {};

  const panel = await http.post(PORTAL_PATHS.semesterPanel, {});
  const semesters = capped(parseOptions(panel), limits.semesters);
  if (semesters.length === 0) throw new Error('no semesters found in the semester panel');

  for (const semester of semesters) {
    let degrees: PortalOption[];
    try {
      degrees = parseOptions(await http.post(PORTAL_PATHS.ajax, { semester: semester.value }));
    } catch (error) {
      if (error instanceof PortalBlockedError) throw error;
      if (error instanceof FixtureMissingError) continue; // not in the recorded slice
      anomalies.push({ stage: 'degrees', semester: semester.value, message: errMsg(error) });
      continue;
    }

    for (const degree of capped(degrees, limits.degrees)) {
      let sectionOpts: PortalOption[];
      try {
        sectionOpts = parseOptions(
          await http.post(PORTAL_PATHS.ajax, {
            semester: semester.value,
            program: degree.value,
          }),
        );
      } catch (error) {
        if (error instanceof PortalBlockedError) throw error;
        if (error instanceof FixtureMissingError) continue; // not in the recorded slice
        anomalies.push({
          stage: 'sections',
          semester: semester.value,
          degree: degree.value,
          message: errMsg(error),
        });
        continue;
      }

      for (const section of capped(sectionOpts, limits.sections)) {
        try {
          const html = await http.post(PORTAL_PATHS.sectionTimetable, {
            semester: semester.value,
            program: degree.value,
            section: section.value,
          });
          sections.push({ semester, degree, section, html });
        } catch (error) {
          if (error instanceof PortalBlockedError) throw error;
          if (error instanceof FixtureMissingError) continue; // not in the recorded slice
          anomalies.push({
            stage: 'timetable',
            semester: semester.value,
            degree: degree.value,
            section: section.value,
            message: errMsg(error),
          });
        }
      }
    }
  }

  return { sections, anomalies };
}
