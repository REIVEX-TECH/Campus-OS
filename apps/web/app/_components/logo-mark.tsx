import Image from 'next/image';

/**
 * The CampusOS logo mark for in-app use: the filled teal disc, one silhouette in
 * both themes so it never appears to change between light and dark. It is the
 * same mark as the favicon and app icons, and self-contained (its own field), so
 * it reads on any surface. Always decorative: every place it appears sits beside
 * a text brand or a link that already carries the accessible name, so it is
 * `alt=""` and hidden from assistive tech. Sized in pixels so it never shifts
 * layout.
 */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return <Image src="/logo-mark.png" width={size} height={size} alt="" className={className} />;
}
