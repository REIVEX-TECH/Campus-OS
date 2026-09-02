/**
 * A deterministic, generated avatar. The same seed always produces the same
 * mark, so a teacher or room looks identical everywhere without storing an
 * image. It is pure geometry plus initials: no photograph, and nothing is
 * inferred about the person from their name.
 *
 * Rendered as inline SVG on the server, so there is no client JS, no network
 * request, and no runtime dependency. Every palette colour carries white text at
 * or above 4.5:1, so the initials meet WCAG AA whichever colour a seed lands on,
 * and the tile is self-contained so it reads on light and dark alike.
 */

/** Colours chosen so white initials clear 4.5:1 on each. Order is part of the seed map. */
const PALETTE = [
  '#0F766E',
  '#4F46E5',
  '#BE123C',
  '#B45309',
  '#047857',
  '#7C3AED',
  '#0369A1',
  '#C2410C',
] as const;

/** FNV-1a (32-bit). Small, stable, and dependency-free: the same string always
 * hashes the same, which is what makes the avatar reproducible. */
export function seedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function seedColor(seed: string): string {
  return PALETTE[seedHash(seed) % PALETTE.length]!;
}

/** Up to two initials from a label, letters and digits only. */
export function initialsOf(label: string): string {
  const words = label
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0]!;
  const second = words.length > 1 ? words[1]![0]! : (words[0]![1] ?? '');
  return (first + second).toUpperCase();
}

export function IdentityAvatar({
  seed,
  label,
  size = 40,
  shape = 'rounded',
  initials,
  className,
}: {
  /** Stable identity for the mark, e.g. a teacher id. */
  seed: string;
  /** Used for the initials, and as the accessible name when `alt` is wanted. */
  label: string;
  size?: number;
  shape?: 'rounded' | 'circle';
  /** Override the derived initials (rooms often read better with their number). */
  initials?: string;
  className?: string;
}) {
  const hash = seedHash(seed);
  const bg = seedColor(seed);
  const text = initials ?? initialsOf(label);
  const radius = shape === 'circle' ? 50 : 28;

  // Two seeded accents give each mark its own geometry while staying quiet: they
  // are white at low alpha, so they read the same over any palette colour.
  const cx = 20 + (hash % 60);
  const cy = 15 + ((hash >>> 5) % 50);
  const r = 26 + ((hash >>> 11) % 26);
  const angle = (hash >>> 17) % 360;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      style={{ flex: 'none' }}
    >
      <defs>
        <clipPath id={`clip-${hash}`}>
          <rect width="100" height="100" rx={radius} ry={radius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${hash})`}>
        <rect width="100" height="100" fill={bg} />
        <circle cx={cx} cy={cy} r={r} fill="#ffffff" opacity="0.14" />
        <rect
          x="55"
          y="55"
          width="60"
          height="60"
          rx="14"
          fill="#ffffff"
          opacity="0.10"
          transform={`rotate(${angle} 85 85)`}
        />
      </g>
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontSize="40"
        fontWeight="600"
        fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      >
        {text}
      </text>
    </svg>
  );
}
