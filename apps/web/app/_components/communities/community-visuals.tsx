import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { hueOf } from '@/lib/communities';

/**
 * A community's generated look: an abstract mark from its icon seed, and a
 * two tone banner from its banner seed. Nothing is uploaded or stored.
 */

export function CommunityIcon({
  seed,
  name,
  size = 40,
  className,
}: {
  seed: string;
  name: string;
  size?: number;
  className?: string;
}) {
  return <IdentityAvatar seed={seed} label={name} kind="place" size={size} className={className} />;
}

export function CommunityBanner({ seed, className = '' }: { seed: string; className?: string }) {
  const h = hueOf(seed);
  return (
    <div
      aria-hidden="true"
      className={`h-24 w-full rounded-2xl sm:h-32 ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 60% 58%))`,
      }}
    />
  );
}
