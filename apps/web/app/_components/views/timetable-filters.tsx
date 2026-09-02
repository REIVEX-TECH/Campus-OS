'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import type { TimetableView } from '@campusos/module-timetable/read';
import { dayShort, kindName, translator, type MessageKey, type Translate } from '../../../lib/i18n';
import { minutes } from './time-scale';

type Kind = TimetableView['kind'];
type GroupId = 'day' | 'kind' | 'course' | 'teacher' | 'room';
type Option = { value: string; label: string };
type Group = {
  id: GroupId;
  options: Option[];
  excluded: ReadonlySet<string>;
  onToggle: (value: string) => void;
};
type Excluded = Record<GroupId, ReadonlySet<string>>;
type FilterState = { from: string; to: string; excluded: Excluded };

const KIND_ORDER: Kind[] = ['lecture', 'lab', 'tutorial', 'exam'];
const GROUP_ORDER: GroupId[] = ['day', 'kind', 'course', 'teacher', 'room'];
const GROUP_LABEL: Record<GroupId, MessageKey> = {
  day: 'timetable.filters.day',
  kind: 'timetable.filters.type',
  course: 'timetable.filters.class',
  teacher: 'timetable.filters.teacher',
  room: 'timetable.filters.room',
};
// URL keys for each excluded dimension (ex-day, ex-kind, ...).
const PARAM: Record<GroupId, string> = {
  day: 'exd',
  kind: 'exk',
  course: 'exc',
  teacher: 'ext',
  room: 'exr',
};

const emptyExcluded = (): Excluded => ({
  day: new Set(),
  kind: new Set(),
  course: new Set(),
  teacher: new Set(),
  room: new Set(),
});

function uniqueOptions(pairs: [string, string][]): Option[] {
  const seen = new Map<string, string>();
  for (const [value, label] of pairs) if (!seen.has(value)) seen.set(value, label);
  return [...seen].map(([value, label]) => ({ value, label }));
}

function readState(sp: URLSearchParams): FilterState {
  const set = (id: GroupId): Set<string> =>
    new Set((sp.get(PARAM[id]) ?? '').split(',').filter(Boolean));
  return {
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    excluded: {
      day: set('day'),
      kind: set('kind'),
      course: set('course'),
      teacher: set('teacher'),
      room: set('room'),
    },
  };
}

/**
 * Read-only filter state shared by every timetable surface (the section view and
 * the teacher / room grids). Filters a class list by a time window plus day,
 * type, class, teacher, and room; each dimension only offers the values present.
 * State lives in the URL (so a filtered view is shareable and survives a reload)
 * and is written with the History API, so toggling a filter does not re-fetch.
 * Filters reset when the underlying section changes.
 */
export function useTimetableFilters(views: TimetableView[], locale: string) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FilterState>(() =>
    readState(new URLSearchParams(sp.toString())),
  );

  const dataKey = `${views.length}:${views[0]?.entryId ?? ''}`;
  // Re-read from the URL when the section changes (the picker drops the filter
  // params on that navigation, so this clears them).
  useEffect(() => {
    setState(readState(new URLSearchParams(sp.toString())));
    setOpen(false);
  }, [dataKey]);

  function commit(next: FilterState): void {
    setState(next);
    const params = new URLSearchParams(sp.toString());
    ['from', 'to', ...Object.values(PARAM)].forEach((k) => params.delete(k));
    if (next.from) params.set('from', next.from);
    if (next.to) params.set('to', next.to);
    for (const id of GROUP_ORDER) {
      const joined = [...next.excluded[id]].join(',');
      if (joined) params.set(PARAM[id], joined);
    }
    const q = params.toString();
    window.history.replaceState(null, '', q ? `${pathname}?${q}` : pathname);
  }

  const optionsById = useMemo<Record<GroupId, Option[]>>(
    () => ({
      day: [...new Set(views.map((v) => v.dayOfWeek))]
        .sort((a, b) => a - b)
        .map((d) => ({ value: String(d), label: dayShort(locale, d) })),
      kind: KIND_ORDER.filter((k) => views.some((v) => v.kind === k)).map((k) => ({
        value: k,
        label: kindName(locale, k),
      })),
      course: uniqueOptions(views.map((v) => [v.course.id, v.course.code])).sort((a, b) =>
        a.label.localeCompare(b.label, locale, { numeric: true }),
      ),
      teacher: uniqueOptions(
        views.flatMap((v) =>
          v.teacher ? [[v.teacher.id, v.teacher.name] as [string, string]] : [],
        ),
      ).sort((a, b) => a.label.localeCompare(b.label, locale)),
      room: uniqueOptions(
        views.flatMap((v) => (v.room ? [[v.room.id, v.room.name] as [string, string]] : [])),
      ).sort((a, b) => a.label.localeCompare(b.label, locale, { numeric: true })),
    }),
    [views, locale],
  );

  const { from, to, excluded } = state;
  const fromMin = from ? minutes(from) : null;
  const toMin = to ? minutes(to) : null;
  const filtered = useMemo(
    () =>
      views.filter((v) => {
        if (excluded.day.has(String(v.dayOfWeek))) return false;
        if (excluded.kind.has(v.kind)) return false;
        if (excluded.course.has(v.course.id)) return false;
        if (v.teacher && excluded.teacher.has(v.teacher.id)) return false;
        if (v.room && excluded.room.has(v.room.id)) return false;
        if (fromMin !== null && minutes(v.endsAt) <= fromMin) return false; // ends before window
        if (toMin !== null && minutes(v.startsAt) >= toMin) return false; // starts after window
        return true;
      }),
    [views, excluded, fromMin, toMin],
  );

  function onToggle(id: GroupId, value: string): void {
    const set = new Set(excluded[id]);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    commit({ ...state, excluded: { ...excluded, [id]: set } });
  }

  const excludedCount = GROUP_ORDER.reduce((n, id) => n + excluded[id].size, 0);
  const activeCount = (from ? 1 : 0) + (to ? 1 : 0) + excludedCount;

  const groups: Group[] = GROUP_ORDER.map((id) => ({
    id,
    options: optionsById[id],
    excluded: excluded[id],
    onToggle: (value: string) => onToggle(id, value),
  }));

  return {
    filtered,
    open,
    setOpen,
    activeCount,
    filterProps: {
      from,
      to,
      onFrom: (v: string) => commit({ ...state, from: v }),
      onTo: (v: string) => commit({ ...state, to: v }),
      groups,
      onClear: () => commit({ from: '', to: '', excluded: emptyExcluded() }),
      hasActive: activeCount > 0,
      locale,
    },
  };
}

export function FilterToggle({
  open,
  setOpen,
  activeCount,
  t,
}: {
  open: boolean;
  setOpen: (updater: (o: boolean) => boolean) => void;
  activeCount: number;
  t: Translate;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      data-print-hide
      className="ios-pressable inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <SlidersHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      {t('timetable.filters')}
      {activeCount > 0 ? (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-xs font-semibold text-background">
          {activeCount}
        </span>
      ) : null}
    </button>
  );
}

export function TimetableFilters({
  from,
  to,
  onFrom,
  onTo,
  groups,
  onClear,
  hasActive,
  locale,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  groups: Group[];
  onClear: () => void;
  hasActive: boolean;
  locale: string;
}) {
  const t = useMemo(() => translator(locale), [locale]);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-wrap gap-3">
          <TimeInput label={t('timetable.filters.from')} value={from} onChange={onFrom} />
          <TimeInput label={t('timetable.filters.to')} value={to} onChange={onTo} />
        </div>

        {groups.map((g) =>
          g.options.length > 1 ? (
            <ChipGroup key={g.id} label={t(GROUP_LABEL[g.id])}>
              {g.options.map((o) => (
                <Chip
                  key={o.value}
                  active={!g.excluded.has(o.value)}
                  onClick={() => g.onToggle(o.value)}
                >
                  {o.label}
                </Chip>
              ))}
            </ChipGroup>
          ) : null,
        )}
      </div>

      {hasActive ? (
        <div>
          <button
            type="button"
            onClick={onClear}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('timetable.filters.clear')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ios-field h-9 rounded-lg px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`ios-pressable rounded-full px-3 py-1 text-sm font-medium ${
        active
          ? 'bg-foreground text-background'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
