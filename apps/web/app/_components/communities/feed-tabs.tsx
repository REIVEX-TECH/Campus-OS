import Link from 'next/link';
import type { FeedSort, TopWindow } from '@campusos/module-communities/feed';
import type { MessageKey, Translate } from '@/lib/i18n';

const SORTS: FeedSort[] = ['hot', 'new', 'top', 'rising', 'controversial'];
const WINDOWS: TopWindow[] = ['hour', 'day', 'week', 'month', 'all'];

const tab = (active: boolean) =>
  `ios-pressable rounded-lg px-2.5 py-1 text-xs font-medium ${
    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
  }`;

/**
 * Feed and sort tabs, as links: every state is a URL, so a page is a page and
 * the back button means something. The window row appears for Top only.
 */
export function FeedTabs({
  feeds,
  feed,
  sort,
  window,
  hrefFor,
  t,
}: {
  feeds: ('home' | 'all')[];
  feed?: 'home' | 'all';
  sort: FeedSort;
  window: TopWindow;
  hrefFor: (patch: Partial<{ feed: string; sort: string; t: string }>) => string;
  t: Translate;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {feeds.length > 1 ? (
          <nav aria-label={t('feeds.feedLabel')} className="flex gap-1">
            {feeds.map((f) => (
              <Link
                key={f}
                href={hrefFor({ feed: f })}
                aria-current={f === feed ? 'page' : undefined}
                className={`ios-pressable rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  f === feed
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`feeds.${f}` as MessageKey)}
              </Link>
            ))}
          </nav>
        ) : null}
        <nav aria-label={t('feeds.sortLabel')} className="flex flex-wrap gap-1">
          {SORTS.map((s) => (
            <Link
              key={s}
              href={hrefFor({ sort: s })}
              aria-current={s === sort ? 'page' : undefined}
              className={tab(s === sort)}
            >
              {t(`feeds.sort.${s}` as MessageKey)}
            </Link>
          ))}
        </nav>
      </div>
      {sort === 'top' ? (
        <nav aria-label={t('feeds.windowLabel')} className="flex flex-wrap gap-1">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={hrefFor({ sort: 'top', t: w })}
              aria-current={w === window ? 'page' : undefined}
              className={tab(w === window)}
            >
              {t(`feeds.window.${w}` as MessageKey)}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
