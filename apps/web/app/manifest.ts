import type { MetadataRoute } from 'next';

// Web app manifest (installable PWA basics). Icons reference the scalable
// favicon and the generated apple icon, so no binary assets are committed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CampusOS',
    short_name: 'CampusOS',
    description: 'Live timetables and campus tools for universities.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0b5d3b',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon', type: 'image/png', sizes: '180x180' },
    ],
  };
}
