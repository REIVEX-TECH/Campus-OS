// Real LGU portal wire protocol. Ported (clean-room no longer required) from
// IIvexII/LGU-TimetableAPI, which is MIT-licensed — see NOTICES.md. All portal
// endpoints are POST with `Cookie: PHPSESSID=<session>` and a form-urlencoded
// body; responses are HTML (a dropdown fragment or the #table-time timetable).

export const PORTAL_BASE_URL = 'https://timetable.lgu.edu.pk';

export const PORTAL_PATHS = {
  /** Page carrying the semester <select> (`#semester option`). No params. */
  semesterPanel: 'Semesters/Semester_pannel.php',
  /** AJAX: degrees (body: semester) and sections (body: semester + program). */
  ajax: 'Semesters/ajax.php',
  /** A section's weekly timetable page (`#table-time`). */
  sectionTimetable: 'Semesters/semester_info/SEMESTER_TIMETABLE.php',
} as const;

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'x'
  );
}

/** Fixture filenames keyed by the request's params (used by the recorder and,
 * after reconciliation, by the fixture HTTP client). */
export const fixtureName = {
  semesterPanel: (): string => 'semester-panel.html',
  degrees: (semester: string): string => `degrees__${slug(semester)}.html`,
  sections: (semester: string, program: string): string =>
    `sections__${slug(semester)}__${slug(program)}.html`,
  timetable: (semester: string, program: string, section: string): string =>
    `timetable__${slug(semester)}__${slug(program)}__${slug(section)}.html`,
};

export interface PortalOption {
  value: string;
  label: string;
}

/** Extract `<option value="…">label</option>` pairs from a dropdown fragment. */
export function parseOptions(html: string): PortalOption[] {
  const options: PortalOption[] = [];
  const re = /<option[^>]*\svalue=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const value = (match[1] ?? '').trim();
    const label = (match[2] ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (value) options.push({ value, label });
  }
  return options;
}
