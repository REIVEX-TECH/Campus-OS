'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Field, Select } from '@campusos/ui';

export type FreeRoomsLabels = {
  day: string;
  from: string;
  to: string;
  now: string;
  days: string[]; // 7 entries, Monday..Sunday
};

/**
 * Day + time-window picker for the free-rooms page. Writes ?day&from&to to the
 * URL (soft navigation, SSR renders the result); the "Free now" button clears
 * them so the server recomputes for the tenant's current local time.
 */
export function FreeRoomsControl({
  day,
  from,
  to,
  labels,
}: {
  day: number;
  from: string;
  to: string;
  labels: FreeRoomsLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function set(next: { day?: number; from?: string; to?: string }): void {
    const params = new URLSearchParams();
    params.set('day', String(next.day ?? day));
    params.set('from', next.from ?? from);
    params.set('to', next.to ?? to);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={labels.day} htmlFor="fr-day">
        <Select id="fr-day" value={day} onChange={(e) => set({ day: Number(e.target.value) })}>
          {labels.days.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={labels.from} htmlFor="fr-from">
        <input
          id="fr-from"
          type="time"
          value={from}
          onChange={(e) => set({ from: e.target.value })}
          className="ios-field h-11 rounded-xl px-3.5 text-[17px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>
      <Field label={labels.to} htmlFor="fr-to">
        <input
          id="fr-to"
          type="time"
          value={to}
          onChange={(e) => set({ to: e.target.value })}
          className="ios-field h-11 rounded-xl px-3.5 text-[17px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>
      <button
        type="button"
        onClick={() => router.replace(pathname, { scroll: false })}
        className="ios-pressable ios-card h-11 rounded-xl px-4 text-sm font-semibold"
      >
        {labels.now}
      </button>
    </div>
  );
}
