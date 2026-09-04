import Link from 'next/link';
import type { CommunitySummary } from '@campusos/module-communities/communities';
import type { CommunityMember } from '@campusos/module-communities/members';
import type { CommunityRule } from '@campusos/module-communities/rules';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import type { MessageKey, Translate } from '@/lib/i18n';

const PLATFORM_RULES = ['harassment', 'hate', 'adult', 'personal', 'threats'] as const;

/** The five rules every community inherits. Shown above a community's own. */
export function PlatformRules({ t }: { t: Translate }) {
  return (
    <div className="ios-card flex flex-col gap-2 rounded-2xl p-4">
      <h2 className="text-sm font-semibold">{t('communities.platformRules')}</h2>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {PLATFORM_RULES.map((r) => (
          <li key={r}>{t(`communities.platformRule.${r}` as MessageKey)}</li>
        ))}
      </ol>
    </div>
  );
}

/** About, rules and moderators, beside a community's page. */
export function CommunityRail({
  community,
  rules,
  moderators,
  base,
  locale,
  canManage,
  canModerate = false,
  t,
}: {
  community: CommunitySummary;
  rules: CommunityRule[];
  moderators: CommunityMember[];
  base: string;
  locale: string;
  canManage: boolean;
  canModerate?: boolean;
  t: Translate;
}) {
  const created = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    community.createdAt,
  );
  return (
    <>
      <div className="ios-card flex flex-col gap-2 rounded-2xl p-4">
        <h2 className="text-sm font-semibold">{t('communities.about')}</h2>
        {community.description ? (
          <p className="text-sm text-muted-foreground">{community.description}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t('communities.members', { count: community.memberCount })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('communities.created', { date: created })}
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-sm">
          <Link
            href={`${base}/c/${community.slug}/members`}
            className="font-medium text-primary hover:underline"
          >
            {t('communities.membersLink')}
          </Link>
          {canManage ? (
            <Link
              href={`${base}/c/${community.slug}/settings`}
              className="font-medium text-primary hover:underline"
            >
              {t('communities.settings')}
            </Link>
          ) : null}
          {canModerate ? (
            <Link
              href={`${base}/c/${community.slug}/mod`}
              className="font-medium text-primary hover:underline"
            >
              {t('mod.tools')}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="ios-card flex flex-col gap-2 rounded-2xl p-4">
        <h2 className="text-sm font-semibold">{t('communities.rules')}</h2>
        <p className="text-xs font-medium text-muted-foreground">
          {t('communities.platformRules')}
        </p>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {PLATFORM_RULES.map((r) => (
            <li key={r}>{t(`communities.platformRule.${r}` as MessageKey)}</li>
          ))}
        </ol>
        <p className="pt-1 text-xs font-medium text-muted-foreground">
          {t('communities.ownRules')}
        </p>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('communities.noOwnRules')}</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            {rules.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{r.title}</span>
                {r.description ? (
                  <span className="block text-muted-foreground">{r.description}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="ios-card flex flex-col gap-2 rounded-2xl p-4">
        <h2 className="text-sm font-semibold">{t('communities.moderators')}</h2>
        <ul className="flex flex-col gap-1.5">
          {moderators.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 text-sm">
              <IdentityAvatar seed={m.avatarSeed} label={m.handle} size={24} />
              <span className="truncate font-medium">{m.handle}</span>
              <span className="text-xs text-muted-foreground">
                {t(`communities.role.${m.roles[0]}` as MessageKey)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
