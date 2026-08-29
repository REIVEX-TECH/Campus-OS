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
  branding: {
    colors: {
      primary: '#0b5d3b',
      background: '#ffffff',
      foreground: '#0a0a0a',
    },
    logoPath: '/tenants/lgu/logo.svg',
  },
  allowedEmailDomains: ['lgu.edu.pk'],
  enabledModules: ['timetable'],
  seo: {
    titleTemplate: '%s · LGU Timetable',
    description: 'Class timetables for Lahore Garrison University — sections, teachers, and rooms.',
    keywords: ['LGU', 'Lahore Garrison University', 'timetable', 'class schedule'],
    aliases: ['lgu.edu.pk'],
  },
};
