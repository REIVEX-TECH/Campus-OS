import type { TenantConfig } from '@campusos/core/tenant';
import type { TimetableView } from '@campusos/module-timetable/read';

/**
 * schema.org JSON-LD builders. These describe public timetable data for search
 * engines (rich results); they add no data and mirror what the page already
 * shows. Recurring weekly slots are modelled with schema.org `Schedule`
 * (`byDay` + wall-clock `startTime`/`endTime`, weekly repeat), which matches how
 * the app stores them, so no fake calendar dates are invented.
 */

const SCHEMA_DAY: readonly string[] = [
  '',
  'https://schema.org/Monday',
  'https://schema.org/Tuesday',
  'https://schema.org/Wednesday',
  'https://schema.org/Thursday',
  'https://schema.org/Friday',
  'https://schema.org/Saturday',
  'https://schema.org/Sunday',
];

/** The platform itself as a WebSite, for the platform landing. */
export function websiteLd(opts: { url: string; description: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'CampusOS',
    url: opts.url,
    description: opts.description,
    // Names the publisher explicitly as the CampusOS organization (below), so search
    // engines attach the site to a CampusOS entity rather than inferring one.
    publisher: { '@id': `${opts.url}#organization` },
  };
}

/**
 * CampusOS as an Organization, for the platform landing. This is the publisher entity
 * the WebSite points at: it names the product and its own logo, so the site reads as
 * CampusOS's, not as another brand's. `sameAs` (official CampusOS social profiles) is
 * left for when those profiles exist; a wrong or borrowed profile would misattribute
 * the entity, which is the opposite of the intent. See docs/SEO.md.
 */
export function organizationLd(opts: { url: string; logo: string }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${opts.url}#organization`,
    name: 'CampusOS',
    url: opts.url,
    logo: opts.logo,
  };
}

/** The tenant as a CollegeOrUniversity, for the tenant home page. */
export function universityLd(tenant: TenantConfig, url: string): object {
  const sameAs = tenant.seo.aliases.map((host) => `https://${host}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollegeOrUniversity',
    name: tenant.displayName,
    url,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/** A course as schema.org Course, with each weekly session as a CourseInstance. */
export function courseLd(opts: {
  course: { code: string; title: string };
  url: string;
  tenant: TenantConfig;
  tenantUrl: string;
  sessions: TimetableView[];
}): object {
  const hasCourseInstance = opts.sessions.map((s) => ({
    '@type': 'CourseInstance',
    courseMode: 'onsite',
    ...(s.room ? { location: { '@type': 'Place', name: s.room.name } } : {}),
    ...(s.teacher ? { instructor: { '@type': 'Person', name: s.teacher.name } } : {}),
    courseSchedule: {
      '@type': 'Schedule',
      byDay: SCHEMA_DAY[s.dayOfWeek],
      startTime: s.startsAt,
      endTime: s.endsAt,
      repeatFrequency: 'P1W',
    },
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: opts.course.title,
    courseCode: opts.course.code,
    url: opts.url,
    provider: {
      '@type': 'CollegeOrUniversity',
      name: opts.tenant.displayName,
      url: opts.tenantUrl,
    },
    ...(hasCourseInstance.length > 0 ? { hasCourseInstance } : {}),
  };
}
