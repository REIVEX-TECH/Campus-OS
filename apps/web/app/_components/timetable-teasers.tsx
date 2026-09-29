import Link from 'next/link';
import { MessageCircle, ShoppingBag } from 'lucide-react';
import { formatPkr } from '@/lib/money';
import type { TeaserTile } from '@/lib/timetable-teasers';

export interface TeaserLabels {
  heading: string;
  confessions: string;
  lostFound: string;
  forSale: string;
  free: string;
}

/**
 * "What's on at LGU right now" strip under the timetable, shown to any viewer. Compact,
 * horizontally scrollable on mobile; each tile links to a page that is public to browse.
 * The page decides which tiles exist (a tile with no data is dropped upstream); this
 * renders nothing when there are none. `data-teaser-*` attributes are here so view/click
 * can be instrumented once platform_events exists, without a redesign.
 */
export function TimetableTeasers({ tiles, labels }: { tiles: TeaserTile[]; labels: TeaserLabels }) {
  if (tiles.length === 0) return null;

  return (
    <section
      aria-labelledby="teaser-heading"
      data-teaser-strip
      className="flex flex-col gap-2 px-1"
    >
      <h2
        id="teaser-heading"
        className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {labels.heading}
      </h2>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {tiles.map((tile) => (
          <li key={tile.kind} className="min-w-[15rem] max-w-[18rem] shrink-0 snap-start sm:flex-1">
            <Link
              href={tile.href}
              data-teaser-tile={tile.kind}
              className="ios-card ios-pressable flex h-full items-center gap-3 rounded-2xl p-3 hover:shadow-[var(--shadow-card-strong)]"
            >
              <Thumb tile={tile} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {tile.kind === 'confession'
                    ? labels.confessions
                    : tile.kind === 'lostfound'
                      ? labels.lostFound
                      : labels.forSale}
                </span>
                <span className="truncate text-sm font-semibold">{tile.title}</span>
                {tile.kind === 'confession' && tile.snippet ? (
                  <span className="truncate text-xs text-muted-foreground">{tile.snippet}</span>
                ) : null}
                {tile.kind === 'marketplace' ? (
                  <span className="text-sm font-semibold text-primary">
                    {tile.pricePaisa === 0 ? labels.free : formatPkr(tile.pricePaisa)}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A photo thumbnail where the tile has one, else a kind icon. Decorative (the title carries the meaning). */
function Thumb({ tile }: { tile: TeaserTile }) {
  const thumbUrl =
    tile.kind === 'lostfound' ? tile.thumbUrl : tile.kind === 'marketplace' ? tile.thumbUrl : null;
  if (thumbUrl) {
    return (
      // A plain <img>, like the listing and lost-and-found cards: an object-store URL, not next/image.
      <img
        src={thumbUrl}
        alt=""
        loading="lazy"
        className="h-12 w-12 shrink-0 rounded-xl object-cover"
      />
    );
  }
  const Icon = tile.kind === 'confession' ? MessageCircle : ShoppingBag;
  return (
    <span
      aria-hidden="true"
      className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
    >
      <Icon className="h-5 w-5" strokeWidth={2} />
    </span>
  );
}
