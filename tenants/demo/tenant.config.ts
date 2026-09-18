import type { TenantConfigInput } from '@campusos/core/tenant';

/**
 * CampusOS Demo University — a fictional tenant for showcasing the platform to
 * prospects and as a staging surface. It impersonates no real institution; all of
 * its content is seeded fixtures (see docs/design-demo-tenant.md and the demo:seed
 * script). Real signed-in users are read-only here, enforced server-side.
 *
 * `isDemo: true` scopes the read-only rule and the seed to this tenant. `joinMode`
 * is 'invite' with no allowed domains, so no real visitor auto-verifies in. Nothing
 * about LGU changes.
 */
export const demo: TenantConfigInput = {
  slug: 'demo',
  displayName: 'CampusOS Demo University',
  aliases: [],
  timezone: 'Asia/Karachi',
  locale: 'en',
  timeFormat: '12h',
  branding: {
    colors: {
      primary: '#2563eb',
      background: '#ffffff',
      foreground: '#0a0a0a',
    },
    logoPath: '/tenants/demo/logo.svg',
  },
  // Closed: nobody auto-verifies into the demo. Real sign-ins get an unverified
  // membership (they can browse signed in) but cannot write (the isDemo rule).
  allowedEmailDomains: [],
  joinMode: 'invite',
  enabledModules: ['timetable', 'communities', 'lost-found', 'messages', 'marketplace', 'rides'],
  moduleSettings: {
    communities: { karmaVisible: true },
  },
  seo: {
    titleTemplate: '%s · CampusOS Demo',
    description:
      'A demonstration campus on CampusOS. Everything here is illustrative, seeded for evaluation.',
    keywords: ['CampusOS demo', 'CampusOS'],
    aliases: [],
  },
  isDemo: true,
  notice:
    'Demo tenant. Users, posts, listings and rides here are illustrative, generated for evaluation. Do not act on any content as if it were real.',
};
