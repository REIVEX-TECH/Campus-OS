import { ImageResponse } from 'next/og';

// The iOS home-screen icon (180x180). Generated via next/og so no binary asset
// is committed. A green rounded field with a white "C" mark (matching icon.svg).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0b5d3b',
        color: '#ffffff',
        fontSize: 118,
        fontWeight: 700,
      }}
    >
      C
    </div>,
    size,
  );
}
