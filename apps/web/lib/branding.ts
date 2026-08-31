import type { CSSProperties } from 'react';

/**
 * Derive the accent CSS variables for a tenant from its branding config. These
 * are injected server-side on the tenant layout wrapper, so the tenant's accent
 * is live with no flash of the default. Tenant-agnostic: driven purely by config
 * (no hardcoded tenant), per CLAUDE.md.
 */
export function accentStyle(primaryHex: string): CSSProperties {
  const vars: Record<string, string> = {
    '--primary': primaryHex,
    '--primary-foreground': readableForeground(primaryHex),
  };
  return vars as CSSProperties;
}

/** Near-black on a light accent, white on a dark accent (WCAG contrast). */
function readableForeground(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return relativeLuminance(r, g, b) > 0.4 ? '#0a0a0a' : '#ffffff';
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
