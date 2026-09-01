/**
 * The tenant module hub. Live modules link to their real pages; "soon" modules
 * are pure UI stubs that open a Coming soon state (no feature, no data). Labels
 * and descriptions come from i18n (`module.<key>.label` / `.desc`). Icons are
 * emoji (theme-agnostic, no asset). This is a UI catalogue, not the real module
 * registry (that lives in packages/modules with manifests).
 */
export interface ModuleCard {
  key: string;
  icon: string;
  /** Path under the tenant base for a live module; absent for "soon" stubs. */
  path?: string;
  soon: boolean;
}

export const MODULES: ModuleCard[] = [
  { key: 'timetable', icon: '📅', path: '/timetable', soon: false },
  { key: 'freeRooms', icon: '🚪', path: '/free-rooms', soon: false },
  { key: 'search', icon: '🔎', path: '/search', soon: false },
  { key: 'marketplace', icon: '🛍️', soon: true },
  { key: 'communities', icon: '💬', soon: true },
  { key: 'lostFound', icon: '🧭', soon: true },
  { key: 'rides', icon: '🚗', soon: true },
  { key: 'map', icon: '🗺️', soon: true },
];

const soonByKey = new Map(MODULES.filter((m) => m.soon).map((m) => [m.key, m]));

/** A "soon" module by key, or null (used to validate the Coming soon route). */
export function soonModule(key: string): ModuleCard | null {
  return soonByKey.get(key) ?? null;
}
