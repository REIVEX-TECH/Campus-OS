import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const SOURCE_ID = 'timetable-lgu';

export const USER_AGENT =
  'CampusOS-Timetable-Ingest/0.1 (+https://github.com/REIVEX-TECH/Campus-OS)';

const envSchema = z.object({
  SOURCE_MODE: z.enum(['live', 'fixture']).default('fixture'),
  LGU_BASE_URL: z.string().url().default('https://lgutimetable.vercel.app'),
  // Treat an empty env value (LGU_PHPSESSID=) as unset.
  LGU_PHPSESSID: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  LGU_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
});

export interface AdapterConfig {
  mode: 'live' | 'fixture';
  baseUrl: string;
  phpSessId?: string;
  concurrency: number;
  userAgent: string;
  fixturesDir: string;
}

const DEFAULT_FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
);

/** Validate adapter configuration from the environment (CLAUDE.md §5). */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  fixturesDir: string = DEFAULT_FIXTURES_DIR,
): AdapterConfig {
  const parsed = envSchema.parse(env);
  return {
    mode: parsed.SOURCE_MODE,
    baseUrl: parsed.LGU_BASE_URL.replace(/\/$/, ''),
    phpSessId: parsed.LGU_PHPSESSID,
    concurrency: parsed.LGU_CONCURRENCY,
    userAgent: USER_AGENT,
    fixturesDir,
  };
}
