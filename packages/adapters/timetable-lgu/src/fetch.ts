import type { AdapterConfig } from './config';
import type { HttpClient } from './http';
import { PORTAL_PATHS, parseOptions, type PortalOption } from './portal';

const MAX_SECTIONS = 3; // bounded, representative slice (full crawl is a follow-up)

export interface RawTimetableRecord {
  section: PortalOption;
  html: string;
}

export interface RawRecords {
  semester: PortalOption;
  degree: PortalOption;
  sections: PortalOption[];
  timetables: RawTimetableRecord[];
}

/**
 * Crawl a representative slice of the portal: the first semester → its first
 * degree → up to MAX_SECTIONS sections → each section's timetable HTML. The same
 * function drives live fetches and fixture replay (via the injected client), so
 * recorded fixtures always match what fetch requests.
 */
export async function crawl(http: HttpClient, _config: AdapterConfig): Promise<RawRecords> {
  const panel = await http.post(PORTAL_PATHS.semesterPanel, {});
  const semester = parseOptions(panel)[0];
  if (!semester) throw new Error('no semesters found in the semester panel');

  const degreesHtml = await http.post(PORTAL_PATHS.ajax, { semester: semester.value });
  const degree = parseOptions(degreesHtml)[0];
  if (!degree) throw new Error('no degrees found for the semester');

  const sectionsHtml = await http.post(PORTAL_PATHS.ajax, {
    semester: semester.value,
    program: degree.value,
  });
  const sections = parseOptions(sectionsHtml).slice(0, MAX_SECTIONS);
  if (sections.length === 0) throw new Error('no sections found for the degree');

  const timetables: RawTimetableRecord[] = [];
  for (const section of sections) {
    const html = await http.post(PORTAL_PATHS.sectionTimetable, {
      semester: semester.value,
      program: degree.value,
      section: section.value,
    });
    timetables.push({ section, html });
  }

  return { semester, degree, sections, timetables };
}
