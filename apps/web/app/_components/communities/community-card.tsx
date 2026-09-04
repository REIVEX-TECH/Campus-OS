import Link from 'next/link';
import type { CommunitySummary } from '@campusos/module-communities/communities';
import type { Translate } from '@/lib/i18n';
import { CommunityIcon } from './community-visuals';

/** One community in a list: mark, name, size, a line about it. The whole card is the link. */
export function CommunityCard({
  community,
  href,
  t,
}: {
  community: CommunitySummary;
  href: string;
  t: Translate;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <article className="ios-card ios-pressable flex items-start gap-3 rounded-2xl p-4">
          <CommunityIcon seed={community.iconSeed} name={community.name} size={44} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="truncate text-base font-semibold">{community.name}</h3>
              <span className="text-xs text-muted-foreground">
                {t('communities.members', { count: community.memberCount })}
              </span>
              {community.approvalStatus === 'pending' ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t('communities.pending')}
                </span>
              ) : null}
            </div>
            {community.description ? (
              <p className="line-clamp-2 text-sm text-muted-foreground">{community.description}</p>
            ) : null}
          </div>
        </article>
      </Link>
    </li>
  );
}
