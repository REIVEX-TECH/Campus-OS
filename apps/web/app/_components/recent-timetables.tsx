'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ModuleIconName } from '@/lib/modules';
import {
  clearLocalRecents,
  mergeRecents,
  readLocalRecents,
  type RecentEntry,
  type RecentKind,
} from '@/lib/recents-local';
import { ModuleIcon } from './module-icon';

export type RecentLabels = {
  heading: string;
  clear: string;
  kind: Record<RecentKind, string>;
};

const ICON: Record<RecentKind, ModuleIconName> = {
  section: 'calendar',
  teacher: 'users',
  room: 'building',
};

/** How many the panel shows. The stores keep more; the page stays compact. */
const SHOWN = 6;

/**
 * Where you were recently, one tap from where you are.
 *
 * The server renders whatever it knows (the account's list, or nothing signed
 * out); after mount the browser's own memory is merged in. That order keeps the
 * first paint identical on server and client, and means a device remembers what
 * it looked at before there was an account to remember it.
 */
export function RecentTimetables({
  tenant,
  initial,
  signedIn,
  labels,
}: {
  tenant: string;
  initial: RecentEntry[];
  signedIn: boolean;
  labels: RecentLabels;
}) {
  const [items, setItems] = useState<RecentEntry[]>(initial);

  useEffect(() => {
    setItems(mergeRecents(initial, readLocalRecents(tenant)));
  }, [tenant, initial]);

  function clear(): void {
    clearLocalRecents(tenant);
    setItems([]);
    if (signedIn) {
      void fetch(`/api/account/recents?tenant=${encodeURIComponent(tenant)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  }

  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="recent-timetables"
      className="ios-card flex flex-col gap-1.5 rounded-2xl p-3"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="recent-timetables" className="text-sm font-semibold">
          {labels.heading}
        </h2>
        <button
          type="button"
          onClick={clear}
          className="ios-pressable rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {labels.clear}
        </button>
      </div>
      <ul className="flex flex-col">
        {items.slice(0, SHOWN).map((r) => (
          <li key={`${r.kind}:${r.key}`}>
            <Link
              href={r.href}
              className="ios-pressable flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-muted"
            >
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-foreground"
                aria-hidden="true"
              >
                <ModuleIcon name={ICON[r.kind]} className="h-4 w-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{r.label}</span>
                <span className="text-xs text-muted-foreground">{labels.kind[r.kind]}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
