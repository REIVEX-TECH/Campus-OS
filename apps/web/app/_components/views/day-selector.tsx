import { dayName, dayShort, type Translate } from '../../../lib/i18n';

/** A horizontal weekday selector (scrollable on narrow screens). Shared by the
 *  day-tabs and timeline views. Only shows the days that have classes. */
export function DaySelector({
  days,
  selected,
  onSelect,
  locale,
  t,
}: {
  days: number[];
  selected: number;
  onSelect: (day: number) => void;
  locale: string;
  t: Translate;
}) {
  return (
    <div
      role="tablist"
      aria-label={t('timetable.view.label')}
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {days.map((day) => {
        const active = day === selected;
        return (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(day)}
            className={`ios-pressable shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'ios-field text-foreground hover:bg-muted'
            }`}
          >
            <span aria-hidden="true">{dayShort(locale, day)}</span>
            <span className="sr-only">{dayName(locale, day)}</span>
          </button>
        );
      })}
    </div>
  );
}
