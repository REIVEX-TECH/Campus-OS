/**
 * The tenant module hub. Live modules link to their real pages; "soon" modules
 * are pure UI stubs that open a Coming soon state (no feature, no data). Labels
 * and descriptions come from i18n (`module.<key>.label` / `.desc`). Each module
 * names a line icon (rendered by `_components/module-icon.tsx`); the icon is a
 * stable string key, not a component, so this data crosses the server/client
 * boundary. This is a UI catalogue, not the real module registry (that lives in
 * packages/modules with manifests).
 */

/** The line icons a module card can name. Keys map to lucide components in
 * `_components/module-icon.tsx`; keep the two in sync. */
export type ModuleIconName =
  | 'calendar'
  | 'door-open'
  | 'search'
  | 'users'
  | 'building'
  | 'shopping-bag'
  | 'message-circle'
  | 'package-search'
  | 'car'
  | 'map';

export interface ModuleCard {
  key: string;
  icon: ModuleIconName;
  /** Path under the tenant base for a live module; absent for "soon" stubs. */
  path?: string;
  soon: boolean;
  /**
   * Kept out of the left navigation. The search box in the top bar is on every
   * page, so a second way to reach the same page would only take a row.
   */
  hideFromNav?: boolean;
  /**
   * Will need to know who is acting once it ships. Drives the sign in page's
   * list of where a handle will be used; the map is read only, so it is absent.
   */
  needsIdentity?: boolean;
}

export const MODULES: ModuleCard[] = [
  { key: 'timetable', icon: 'calendar', path: '/timetable', soon: false },
  { key: 'freeRooms', icon: 'door-open', path: '/free-rooms', soon: false },
  { key: 'search', icon: 'search', path: '/search', soon: false, hideFromNav: true },
  { key: 'teachers', icon: 'users', path: '/teachers', soon: false },
  { key: 'rooms', icon: 'building', path: '/rooms', soon: false },
  { key: 'marketplace', needsIdentity: true, icon: 'shopping-bag', soon: true },
  { key: 'communities', needsIdentity: true, icon: 'message-circle', soon: true },
  { key: 'lostFound', needsIdentity: true, icon: 'package-search', soon: true },
  { key: 'rides', needsIdentity: true, icon: 'car', soon: true },
  { key: 'map', icon: 'map', soon: true },
];

const soonByKey = new Map(MODULES.filter((m) => m.soon).map((m) => [m.key, m]));

/** A "soon" module by key, or null (used to validate the Coming soon route). */
export function soonModule(key: string): ModuleCard | null {
  return soonByKey.get(key) ?? null;
}
