/**
 * Recently viewed timetables, kept in the browser.
 *
 * Signed out, this is the only memory the page has. Signed in, the server holds
 * the list as well and the two are merged, newest first, so a device remembers
 * what it saw even before sign in and the account remembers across devices.
 * Pure functions apart from the two that touch storage, so the merge can be
 * tested without a browser.
 */

export type RecentKind = 'section' | 'teacher' | 'room';

export interface RecentEntry {
  kind: RecentKind;
  key: string;
  label: string;
  /** Relative path only. */
  href: string;
  /** Epoch milliseconds, so it survives JSON and crosses to the client as is. */
  viewedAt: number;
}

/** How many the browser keeps per tenant. */
export const LOCAL_RECENTS_KEPT = 20;

export function recentsStorageKey(tenant: string): string {
  return `campusos_recents:${tenant}`;
}

function identity(entry: RecentEntry): string {
  return `${entry.kind}:${entry.key}`;
}

/** Newest first, one entry per kind and key, capped. Pure. */
export function mergeRecents(...lists: readonly (readonly RecentEntry[])[]): RecentEntry[] {
  const byId = new Map<string, RecentEntry>();
  for (const list of lists) {
    for (const entry of list) {
      const id = identity(entry);
      const seen = byId.get(id);
      if (!seen || entry.viewedAt > seen.viewedAt) byId.set(id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => b.viewedAt - a.viewedAt).slice(0, LOCAL_RECENTS_KEPT);
}

function isEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === 'section' || v.kind === 'teacher' || v.kind === 'room') &&
    typeof v.key === 'string' &&
    typeof v.label === 'string' &&
    typeof v.href === 'string' &&
    v.href.startsWith('/') &&
    typeof v.viewedAt === 'number'
  );
}

/** Whatever the browser remembers for this tenant. Empty on any trouble. */
export function readLocalRecents(tenant: string): RecentEntry[] {
  try {
    const raw = window.localStorage.getItem(recentsStorageKey(tenant));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** Remember one more view. Quietly does nothing where storage is unavailable. */
export function writeLocalRecent(tenant: string, entry: RecentEntry): void {
  try {
    const next = mergeRecents([entry], readLocalRecents(tenant));
    window.localStorage.setItem(recentsStorageKey(tenant), JSON.stringify(next));
  } catch {
    // Private mode, quota, or a browser set to block site data. Nothing to do.
  }
}

export function clearLocalRecents(tenant: string): void {
  try {
    window.localStorage.removeItem(recentsStorageKey(tenant));
  } catch {
    // As above.
  }
}
