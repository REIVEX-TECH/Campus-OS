export interface RidesReputationAggregate {
  average: number | null;
  count: number;
}

export interface RidesReputationComment {
  stars: number;
  comment: string;
}

export interface RidesReputationLabels {
  heading: string;
  asDriver: string;
  asPassenger: string;
  count: string;
  none: string;
}

function Aggregate({
  label,
  agg,
  countLabel,
}: {
  label: string;
  agg: RidesReputationAggregate;
  countLabel: string;
}) {
  if (agg.count === 0 || agg.average === null) return null;
  const rounded = Math.round(agg.average);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span aria-hidden="true" className="text-sm text-warning">
        {'★'.repeat(rounded)}
        <span className="text-muted-foreground/40">{'★'.repeat(5 - rounded)}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {agg.average.toFixed(1)} {'·'} {countLabel.replace('{n}', String(agg.count))}
      </span>
    </div>
  );
}

/** A person's ride reputation: driver and passenger averages plus recent comments. */
export function RidesReputation({
  asDriver,
  asPassenger,
  recent,
  labels,
}: {
  asDriver: RidesReputationAggregate;
  asPassenger: RidesReputationAggregate;
  recent: RidesReputationComment[];
  labels: RidesReputationLabels;
}) {
  const hasAny = asDriver.count > 0 || asPassenger.count > 0;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-lg font-semibold tracking-tight">{labels.heading}</h2>
      {!hasAny ? (
        <p className="px-1 text-sm text-muted-foreground">{labels.none}</p>
      ) : (
        <div className="ios-card flex flex-col gap-3 rounded-2xl p-3">
          <div className="flex flex-col gap-1">
            <Aggregate label={labels.asDriver} agg={asDriver} countLabel={labels.count} />
            <Aggregate label={labels.asPassenger} agg={asPassenger} countLabel={labels.count} />
          </div>
          {recent.length > 0 ? (
            <ul className="flex flex-col gap-3 border-t border-border/60 pt-3">
              {recent.map((r, i) => (
                <li key={i} className="flex flex-col gap-0.5">
                  <span aria-hidden="true" className="text-sm text-warning">
                    {'★'.repeat(r.stars)}
                    <span className="text-muted-foreground/40">{'★'.repeat(5 - r.stars)}</span>
                  </span>
                  <p className="text-sm text-muted-foreground">{r.comment}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
