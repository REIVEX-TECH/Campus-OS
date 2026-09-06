import type { TenantConfigInput } from '@campusos/core/tenant';

/**
 * Lahore Garrison University — the first tenant.
 * `slug` is permanent (see CLAUDE.md §4); everything else here is mutable.
 */
export const lgu: TenantConfigInput = {
  slug: 'lgu',
  displayName: 'Lahore Garrison University',
  aliases: [],
  timezone: 'Asia/Karachi',
  locale: 'en',
  timeFormat: '12h',
  branding: {
    colors: {
      primary: '#0b5d3b',
      background: '#ffffff',
      foreground: '#0a0a0a',
    },
    logoPath: '/tenants/lgu/logo.svg',
  },
  allowedEmailDomains: ['lgu.edu.pk'],
  // Anyone with a verified lgu.edu.pk address joins as a student.
  joinMode: 'domain',
  enabledModules: ['timetable', 'communities'],
  seo: {
    titleTemplate: '%s · LGU Timetable',
    description:
      'Live class timetables for Lahore Garrison University. Find your section, teacher, and room schedule, and free rooms on campus.',
    keywords: [
      'LGU timetable',
      'LGU',
      'Lahore Garrison University',
      'Lahore Garrison University timetable',
      'LGU class schedule',
      'LGU free rooms',
      'timetable',
      'class schedule',
    ],
    aliases: ['lgu.edu.pk'],
  },
};
