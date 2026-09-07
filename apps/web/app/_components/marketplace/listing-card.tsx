import Link from 'next/link';
import { mediaUrl } from '@campusos/media';
import type { ListingSummary } from '@campusos/module-marketplace/listings';
import { formatPkr } from '@/lib/money';

export interface ListingCardLabels {
  free: string;
  negotiable: string;
  conditionLabels: Record<string, string>;
}

/** One listing in the browse grid: photo, title, price, condition. */
export function ListingCard({
  listing,
  base,
  labels,
}: {
  listing: ListingSummary;
  base: string;
  labels: ListingCardLabels;
}) {
  const price = listing.pricePaisa === 0 ? labels.free : formatPkr(listing.pricePaisa);
  return (
    <Link
      href={`${base}/marketplace/${listing.id}`}
      className="ios-card ios-pressable flex flex-col overflow-hidden rounded-2xl"
    >
      <div className="aspect-square w-full bg-muted">
        {listing.thumbKey ? (
          <img
            src={mediaUrl(listing.thumbKey)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="truncate text-sm font-semibold">{listing.title}</span>
        <span className="text-sm font-medium">
          {price}
          {listing.priceKind === 'negotiable' && listing.pricePaisa > 0 ? (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {labels.negotiable}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {labels.conditionLabels[listing.condition] ?? listing.condition}
        </span>
      </div>
    </Link>
  );
}
