/**
 * The compact figure row on a profile. Each tile is one number with its label,
 * so the week reads at a glance before the timetable itself. Values are already
 * formatted by the caller; tiles carry no colour of their own so the grid stays
 * quiet in both themes.
 */
export function StatGrid({ stats }: { stats: { label: string; value: string }[] }) {
  if (stats.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => (
        <li key={s.label} className="ios-card flex flex-col gap-0.5 rounded-xl p-3">
          <span className="text-lg font-semibold tabular-nums">{s.value}</span>
          <span className="text-xs text-muted-foreground">{s.label}</span>
        </li>
      ))}
    </ul>
  );
}
