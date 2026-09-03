import { describe, expect, it } from 'vitest';
import { accentStyle } from '@/lib/branding';

/**
 * The tenant accent is injected as an inline style on the tenant wrapper, and the
 * stylesheet's `.dark [data-tenant]` rule is meant to swap in a lightened accent.
 * An inline declaration always beats a stylesheet rule on the same element, so
 * if the inline style sets `--primary` itself the swap can never win: dark mode
 * showed the raw accent, and dark green links on a near black page failed AA.
 * The inline style must therefore only supply raw inputs the stylesheet chooses
 * between, never the token it is meant to resolve.
 */
describe('accentStyle', () => {
  const style = accentStyle('#0b5d3b') as Record<string, string>;

  it('supplies both themes as raw inputs, and never the resolved token', () => {
    expect(style['--tenant-primary']).toBe('#0b5d3b');
    expect(style['--tenant-primary-foreground']).toBe('#ffffff');
    expect(style['--tenant-primary-dark']).toMatch(/^#[0-9a-f]{6}$/);
    expect(style['--tenant-primary-foreground-dark']).toBe('#0a0a0a');
    expect(style).not.toHaveProperty('--primary');
    expect(style).not.toHaveProperty('--primary-foreground');
  });

  it('lightens a dark accent enough to read on the dark page', () => {
    // A relative luminance of at least 0.45 is what lightenForDark aims for,
    // which is comfortably above AA for text on the near black background.
    const hex = style['--tenant-primary-dark']!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    expect(luminance).toBeGreaterThanOrEqual(0.45);
  });
});
