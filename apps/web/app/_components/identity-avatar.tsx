import { avatarSrc, type AvatarKind } from '@/lib/avatar';

/**
 * A deterministic generated avatar: the same entity always shows the same
 * picture, everywhere, without storing an image. People get an illustrated
 * character, rooms get an abstract mark.
 *
 * It renders a plain <img> pointing at the avatar route, which draws the SVG on
 * the server and is cached immutably. That keeps the illustration off the client
 * bundle entirely, and lets this component be used from server and client trees
 * alike. Decorative by default, because every place it appears sits beside the
 * entity's name as real text.
 */
export function IdentityAvatar({
  seed,
  label,
  kind = 'person',
  size = 40,
  className,
  decorative = true,
}: {
  /** Stable identity for the picture, normally an entity id. */
  seed: string;
  /** Used as the accessible name when the avatar is not decorative. */
  label: string;
  kind?: AvatarKind;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  return (
    // A plain <img>, not next/image: the avatar route already returns a
    // fixed-size, immutably cached SVG, so the optimiser has nothing to add.
    <img
      src={avatarSrc(kind, seed)}
      width={size}
      height={size}
      alt={decorative ? '' : label}
      loading="lazy"
      decoding="async"
      className={className}
      style={{ flex: 'none', borderRadius: '9999px' }}
    />
  );
}
