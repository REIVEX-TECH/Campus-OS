import Link from 'next/link';
import { mediaUrl } from '@campusos/media';
import type { ItemSummary } from '@campusos/module-lost-found/items';
import { categoryLabel } from '@/lib/lost-found';
import type { Translate } from '@/lib/i18n';

/** One item in the browse list. The whole card links to the item page. */
export function ItemCard({ item, base, t }: { item: ItemSummary; base: string; t: Translate }) {
  const kindLabel = t(item.kind === 'found' ? 'lostFound.kind.found' : 'lostFound.kind.lost');
  return (
    <Link
      href={`${base}/lost-found/${item.id}`}
      className="ios-card ios-pressable flex gap-3 rounded-2xl p-3 sm:p-4"
    >
      {item.thumbKey ? (
        <img
          src={mediaUrl(item.thumbKey)}
          alt=""
          width={64}
          height={64}
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground"
        >
          {kindLabel}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              item.kind === 'found'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {kindLabel}
          </span>
          {item.status === 'resolved' ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {t('lostFound.status.resolved')}
            </span>
          ) : null}
          <span className="text-[11px] text-muted-foreground">
            {categoryLabel(t, item.category)}
          </span>
        </div>
        <h3 className="truncate text-sm font-semibold">{item.title}</h3>
        {item.locationText ? (
          <p className="truncate text-xs text-muted-foreground">{item.locationText}</p>
        ) : null}
      </div>
    </Link>
  );
}
