import Link from 'next/link';
import type { ModLogEntry } from '@campusos/module-communities/queue';
import { relativeTime } from '@/lib/format';
import type { MessageKey, Translate } from '@/lib/i18n';

/** The actions with a sentence of their own; anything else reads as its name. */
const KNOWN = new Set([
  'remove_post',
  'remove_comment',
  'approve_post',
  'approve_comment',
  'lock',
  'unlock',
  'pin',
  'unpin',
  'ban',
  'unban',
  'mute',
  'unmute',
  'settings.updated',
  'rules.updated',
  'grant',
  'revoke',
]);

/**
 * The mod log as a list. Each line names the moderator and what they did; a
 * line about a member names them only for moderators, because the module
 * already withheld the handle for everyone else.
 */
export function ModLog({
  entries,
  base,
  communitySlug,
  locale,
  isModerator,
  t,
}: {
  entries: ModLogEntry[];
  base: string;
  communitySlug: string;
  locale: string;
  isModerator: boolean;
  t: Translate;
}) {
  if (entries.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">{t('mod.logEmpty')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {!isModerator ? (
        <p className="px-1 text-xs text-muted-foreground">{t('mod.logPublicNote')}</p>
      ) : null}
      <ol className="ios-card flex flex-col rounded-2xl p-2">
        {entries.map((e) => {
          const handle = e.targetType === 'user' ? (e.targetHandle ?? t('mod.someone')) : '';
          const what = KNOWN.has(e.action)
            ? t(`mod.action.${e.action}` as MessageKey, { handle })
            : e.action.replace(/[._]/g, ' ');
          const postId =
            e.targetType === 'post'
              ? e.targetId
              : typeof e.meta?.postId === 'string'
                ? e.meta.postId
                : null;
          return (
            <li key={e.id} className="flex flex-col gap-0.5 rounded-xl px-2 py-2 text-sm">
              <p>
                <span className="font-medium">{e.actorHandle ?? t('mod.someone')}</span>{' '}
                {postId ? (
                  <Link
                    href={`${base}/c/${communitySlug}/post/${postId}`}
                    className="hover:underline"
                  >
                    {what}
                  </Link>
                ) : (
                  what
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {relativeTime(e.createdAt.toISOString(), locale)}
                {e.reason ? ` · ${e.reason}` : ''}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
