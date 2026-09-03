/**
 * Seeding for the generated avatars, shared by the renderer and its callers.
 *
 * The same entity always resolves to the same picture, because everything is a
 * pure function of the seed (an entity id). Avatars are illustrations, never
 * photographs, and nothing about them is derived from a person's name, so no
 * appearance is ever inferred from who someone is.
 */
export const AVATAR_KINDS = ['person', 'place'] as const;
export type AvatarKind = (typeof AVATAR_KINDS)[number];

/** Backgrounds chosen to sit calmly behind an illustration in light and dark. */
const BACKGROUNDS = [
  '#0F766E',
  '#4F46E5',
  '#BE123C',
  '#B45309',
  '#047857',
  '#7C3AED',
  '#0369A1',
  '#C2410C',
] as const;

/**
 * What a seed may contain. Entity ids, slugs and the identity module's avatar
 * seeds all have to pass this, because the avatar route refuses anything else:
 * it keeps the cache key bounded and the seed inert in a URL.
 */
export const AVATAR_SEED_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** FNV-1a (32-bit): small, stable, dependency-free, and reproducible. */
export function seedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The backdrop for this seed's avatar. */
export function avatarBackground(seed: string): string {
  return BACKGROUNDS[seedHash(seed) % BACKGROUNDS.length]!;
}

/** The URL that renders this entity's avatar. */
export function avatarSrc(kind: AvatarKind, seed: string): string {
  return `/api/avatar/${kind}/${encodeURIComponent(seed)}`;
}
