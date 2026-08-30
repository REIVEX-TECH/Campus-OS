import type { ZodTypeAny } from 'zod';

/** A route a module contributes; the host app resolves the component by id. */
export interface ModuleRoute {
  path: string;
  id: string;
}

export interface ModuleNavItem {
  label: string;
  href: string;
  icon?: string;
}

export interface ModulePermission {
  id: string;
  description: string;
}

export interface ModuleJob {
  id: string;
  /** Cron expression; omitted for manually-triggered jobs. */
  schedule?: string;
}

export interface ModuleApiRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  id: string;
}

export interface ModuleEventHandler {
  event: string;
  id: string;
}

/** Where a module's own migrations live (run after base db migrations). */
export interface ModuleMigrations {
  folder: string;
}

/**
 * The manifest every feature module default-exports (CLAUDE.md §4). Core
 * discovers and mounts modules from these; a disabled module contributes
 * nothing (no routes, nav, or queries).
 */
export interface ModuleManifest {
  id: string;
  version: string;
  routes: ModuleRoute[];
  navigation: ModuleNavItem[];
  permissions: ModulePermission[];
  settingsSchema: ZodTypeAny;
  migrations: ModuleMigrations;
  jobs: ModuleJob[];
  apiRoutes: ModuleApiRoute[];
  eventHandlers: ModuleEventHandler[];
}

/** Identity helper for type-checked manifest definitions. */
export function defineManifest(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}
