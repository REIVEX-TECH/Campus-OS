import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineManifest, type ModuleManifest } from '@campusos/core/module';

/** Absolute path to this module's migrations (run after base db migrations). */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

export const settingsSchema = z.object({
  weekStartsOn: z.number().int().min(1).max(7).default(1),
  visibleKinds: z
    .array(z.enum(['lecture', 'lab', 'tutorial', 'exam']))
    .default(['lecture', 'lab', 'tutorial', 'exam']),
});

export const manifest: ModuleManifest = defineManifest({
  id: 'timetable',
  version: '0.1.0',
  routes: [],
  navigation: [],
  permissions: [
    { id: 'timetable.read', description: 'View timetables' },
    { id: 'timetable.subscribe', description: 'Subscribe to timetable changes' },
    { id: 'timetable.ingest', description: 'Run timetable ingestion' },
  ],
  settingsSchema,
  migrations: { folder: migrationsFolder },
  jobs: [],
  apiRoutes: [],
  eventHandlers: [],
});

export default manifest;
