import { ImageResponse } from 'next/og';

// The platform landing's OpenGraph/Twitter card (1200x630). Same generated-image
// approach as the tenant card, without a tenant accent. Next wires og:image and
// twitter:image from this file convention.
export const alt = 'CampusOS';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
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
        <div style={{ width: 22, height: 22, borderRadius: 7, background: '#0b5d3b' }} />
        <span style={{ fontWeight: 600 }}>CampusOS</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: '#ffffff', fontSize: 68, fontWeight: 700, lineHeight: 1.05 }}>
          Campus tools that stay current.
        </div>
        <div style={{ color: '#a1a1aa', fontSize: 38 }}>
          Live timetables, free rooms, and search. Free and open-source.
        </div>
      </div>
    </div>,
    size,
  );
}
