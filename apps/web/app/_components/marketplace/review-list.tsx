import type { GigReview } from '@campusos/module-marketplace/orders-read';

export interface ReviewListLabels {
  heading: string;
  summary: string;
  empty: string;
  anon: string;
}

/** A gig's or a seller's public reviews, with a rating summary. Presentational. */
export function ReviewList({
  reviews,
  count,
  average,
  labels,
}: {
  reviews: GigReview[];
  count: number;
  average: number | null;
  labels: ReviewListLabels;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-lg font-semibold tracking-tight">{labels.heading}</h2>
        {count > 0 && average !== null ? (
          <span className="text-sm text-muted-foreground">
            {labels.summary.replace('{avg}', average.toFixed(1)).replace('{count}', String(count))}
          </span>
        ) : null}
      </div>
      {reviews.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="ios-card flex flex-col gap-3 rounded-2xl p-3">
          {reviews.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-sm text-warning">
                  {'★'.repeat(r.rating)}
                  <span className="text-muted-foreground/40">{'★'.repeat(5 - r.rating)}</span>
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {r.reviewerHandle ?? labels.anon}
                </span>
              </div>
              {r.body ? <p className="text-sm text-muted-foreground">{r.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
