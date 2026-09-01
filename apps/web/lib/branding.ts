import type { CSSProperties } from 'react';

/**
 * Derive the accent CSS variables for a tenant from its branding config. These
 * are injected server-side on the tenant layout wrapper, so the tenant's accent
 * is live with no flash of the default. Tenant-agnostic: driven purely by config
 * (no hardcoded tenant), per CLAUDE.md.
 */
export function accentStyle(primaryHex: string): CSSProperties {
  // Dark-mode accent: the raw accent is often dark (LGU green), which fails AA as
  // link text on a near-black page, so a lightened variant is used in dark mode
  // (see the `.dark [data-tenant]` rule in globals.css).
  const dark = lightenForDark(primaryHex);
  const vars: Record<string, string> = {
    '--primary': primaryHex,
    '--primary-foreground': readableForeground(primaryHex),
    '--primary-dark': dark,
    '--primary-foreground-dark': readableForeground(dark),
  };
  return vars as CSSProperties;
}

/** Near-black on a light accent, white on a dark accent (WCAG contrast). */
function readableForeground(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return relativeLuminance(r, g, b) > 0.4 ? '#0a0a0a' : '#ffffff';
}

/**
 * Blend the accent toward white until it is bright enough to read as link text
 * and button fills on the dark page (WCAG AA against the near-black background).
 * Preserves hue enough to stay recognisably the brand colour.
 */
function lightenForDark(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  let t = 0.35;
  let rr = r;
  let gg = g;
  let bb = b;
  for (let i = 0; i < 8; i += 1) {
    rr = Math.round(r + (255 - r) * t);
    gg = Math.round(g + (255 - g) * t);
    bb = Math.round(b + (255 - b) * t);
    if (relativeLuminance(rr, gg, bb) >= 0.45) break;
    t += 0.1;
  }
  const hx = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${hx(rr)}${hx(gg)}${hx(bb)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance of an sRGB colour (0 = black, 1 = white). */
function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
