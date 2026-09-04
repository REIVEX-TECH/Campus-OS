/**
 * Boot-time environment assertion.
 *
 * The recurring failure this closes: a variable added to `.env` never reaches the
 * running process because `ecosystem.config.cjs` only forwarded an explicit,
 * hand-maintained list, and `pm2 restart --update-env` re-reads that config, not
 * `.env`. It bit `DATABASE_URL`, then `PLATFORM_HOST`, then `TENANT_BASE_DOMAIN`,
 * then `SUPERADMIN_EMAILS` - each time silently: the process simply saw an empty
 * value and degraded (no platform admin, wrong routing) with no error anywhere.
 *
 * The fix has two halves that share ONE source of truth (`app-env.vars.json`):
 *   1. `ecosystem.config.cjs` derives its forward-list from that file, so a var
 *      declared once is forwarded automatically - no second list to forget.
 *   2. `assertAppEnv()` runs at boot (from `instrumentation.ts`) and refuses to
 *      let the process serve traffic if the wiring is wrong. It fails CLOSED and
 *      LOUD rather than degrading silently.
 *
 * Two checks:
 *   - REQUIRED vars must be present and non-empty in the process (always).
 *   - Every var that `.env` sets must have actually reached the process
 *     (production only - in dev, Next loads `.env*` itself, so there is no
 *     forwarding layer to verify).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import manifest from './app-env.vars.json';

type EnvVar = { name: string; required: boolean };

const VARS: EnvVar[] = manifest.vars;

const nonEmpty = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * Minimal `.env` reader - enough for this repo's flat `KEY=value` format. We do
 * not depend on `dotenv` here so this module stays require-able from anywhere
 * (including a slim production install) with zero dependencies. Only the KEYS
 * and whether they are non-empty matter; values are never logged.
 */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Locate the deployment `.env`. Walk up from a start directory to the repo root
 * (the pm2 process runs with cwd `apps/web`, so `.env` is a level or two up).
 * Returns null when no file is found - some deployments inject env directly and
 * have no file to compare against; that is not an error.
 */
function findEnvFile(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export type AssertOptions = {
  /** Environment to check. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Explicit `.env` path (tests). Defaults to a walk-up search. */
  dotenvPath?: string | null;
  /** Where the walk-up search starts. Defaults to the process working dir. */
  startDir?: string;
  /** Force the `.env` forwarding comparison regardless of NODE_ENV (tests). */
  forceCompare?: boolean;
};

/**
 * Throws an Error describing every problem, or returns silently. The thrown
 * error is what `instrumentation.ts` turns into a hard boot crash; keeping the
 * throw here (rather than exiting) makes the logic unit-testable.
 */
export function assertAppEnv(opts: AssertOptions = {}): void {
  const env = opts.env ?? process.env;
  const problems: string[] = [];

  for (const v of VARS) {
    if (v.required && !nonEmpty(env[v.name])) {
      problems.push(`  - ${v.name} is REQUIRED but missing/empty in the process environment.`);
    }
  }

  const isProd = (env.NODE_ENV ?? '') === 'production';
  if (opts.forceCompare || isProd) {
    const dotenvPath =
      opts.dotenvPath !== undefined ? opts.dotenvPath : findEnvFile(opts.startDir ?? process.cwd());
    if (dotenvPath && existsSync(dotenvPath)) {
      let parsed: Record<string, string> = {};
      try {
        parsed = parseEnvFile(readFileSync(dotenvPath, 'utf8'));
      } catch {
        // Unreadable .env: cannot compare; the required check above still runs.
        parsed = {};
      }
      for (const v of VARS) {
        if (nonEmpty(parsed[v.name]) && !nonEmpty(env[v.name])) {
          problems.push(
            `  - ${v.name} is set in ${dotenvPath} but did NOT reach the ` +
              `process (pm2 / ecosystem forwarding gap).`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      'Environment misconfiguration detected at boot:\n' +
        problems.join('\n') +
        '\n\nRuntime env vars are declared once in apps/web/lib/app-env.vars.json; ' +
        'ecosystem.config.cjs forwards exactly that set. Add the variable there ' +
        'if it is new, then restart so the ecosystem re-reads .env ' +
        '(pm2 restart ecosystem.config.cjs --update-env). ' +
        'See docs/runbooks/platform-admin-credentials.md.',
    );
  }
}
