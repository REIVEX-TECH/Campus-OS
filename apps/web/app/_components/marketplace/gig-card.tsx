import Link from 'next/link';
import { mediaUrl } from '@campusos/media';
import type { GigSummary } from '@campusos/module-marketplace/services-read';
import { formatPkr } from '@/lib/money';

export interface GigCardLabels {
  from: string;
  /** Category key -> label. */
  categoryLabels: Record<string, string>;
}

/** One gig in the browse grid: cover thumb (if any), title, "from Rs X", category. */
export function GigCard({
  gig,
  base,
  labels,
}: {
  gig: GigSummary;
  base: string;
  labels: GigCardLabels;
}) {
  const price = gig.fromPricePaisa === null ? null : formatPkr(gig.fromPricePaisa);
  return (
    <Link
      href={`${base}/services/${gig.id}`}
      className="ios-card ios-pressable flex flex-col overflow-hidden rounded-2xl"
    >
      <div className="aspect-video w-full bg-muted">
        {gig.coverThumbKey ? (
          <img
            src={mediaUrl(gig.coverThumbKey)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="line-clamp-2 text-sm font-semibold">{gig.title}</span>
        <span className="text-xs text-muted-foreground">
          {labels.categoryLabels[gig.category] ?? gig.category}
        </span>
        {price ? (
          <span className="text-sm font-medium">
            <span className="text-xs font-normal text-muted-foreground">{labels.from} </span>
            {price}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
