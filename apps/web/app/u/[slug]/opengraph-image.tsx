import { ImageResponse } from 'next/og';
import { getTenantRegistry } from '@/lib/tenants';

// A generated OpenGraph/Twitter card image per tenant (1200x630). Server-only
// via next/og (first-party, no client bundle, no external asset). Next wires the
// og:image and twitter:image automatically from this file convention. Uses the
// library's default font (Latin), so no font file is bundled.
export const alt = 'Campus timetable';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Params = { params: Promise<{ slug: string }> };

export default async function OpengraphImage({ params }: Params) {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  const name = tenant?.displayName ?? 'CampusOS';
  const accent = tenant?.branding.colors.primary ?? '#0b5d3b';

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0a0a0a',
        padding: 80,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 18, color: '#ffffff', fontSize: 34 }}
      >
        <div style={{ width: 22, height: 22, borderRadius: 7, background: accent }} />
        <span style={{ fontWeight: 600 }}>CampusOS</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: '#ffffff', fontSize: 68, fontWeight: 700, lineHeight: 1.05 }}>
          {name}
        </div>
        <div style={{ color: '#a1a1aa', fontSize: 38 }}>
          Live class timetables, free rooms, and search.
        </div>
      </div>
    </div>,
    size,
  );
}
