import { Card } from '@campusos/ui';

/** One number with its label. */
export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-2xl font-bold tabular-nums tracking-tight">{value}</span>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </Card>
  );
}

/** A labelled horizontal bar. The count is shown as text, so the bar is decorative. */
export function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const width = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-sm text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}
