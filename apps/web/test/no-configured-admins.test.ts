import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * tenant_admin is a granted role, never seeded from config.
 *
 * The `adminEmails` config list and the sign-in path that read it
 * (`ensureConfiguredAdmin` / `isConfiguredAdmin` and the
 * `auth_grant_configured_admin` definer) were retired: a DB-editable value must
 * never decide who is an administrator (CLAUDE.md 8, the 0016 residual). Existing
 * config admins were converted to real memberships by the one-time 0023
 * migration, and the role is now granted only through the roles UI under a grant.
 * This scan keeps the mechanism retired in the LIVE code. A future "just add it
 * back" would have to delete this test to land.
 *
 * Not scanned: the drizzle migrations (immutable history: 0019 created it, 0023
 * converted, 0025 dropped it), the test files (they name it to explain the
 * replacement), and docs/pr records. Those describe what was, not what runs.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const BANNED = [
  /ensureConfiguredAdmin/,
  /isConfiguredAdmin/,
  /\badminEmails\b/,
  /auth_grant_configured_admin/,
];

// Live code only. `auth_migrate_configured_admin` (the owner-only 0023 conversion
// tool) is a different name and is not banned. Module src dirs are discovered, not
// hardcoded, so a future module cannot reintroduce the path unscanned.
function moduleSrcDirs(): string[] {
  const found: string[] = [];
  for (const parent of ['packages', join('packages', 'modules')]) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(repoRoot, parent));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const src = join(parent, entry, 'src');
      if (statSyncSafe(join(repoRoot, src))) found.push(src);
    }
  }
  return found;
}

function statSyncSafe(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const SCAN = [...moduleSrcDirs(), 'apps/web/app', 'apps/web/lib', 'apps/web/messages', 'tenants'];

function collect(path: string, acc: string[]): void {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (['node_modules', '.next', 'dist', 'drizzle', 'test'].includes(entry)) continue;
      collect(join(path, entry), acc);
    }
  } else if (/\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path)) {
    acc.push(path);
  }
}

describe('no configured admins', () => {
  it('no live code seeds tenant_admin from config', () => {
    const files: string[] = [];
    for (const rel of SCAN) collect(join(repoRoot, rel), files);
    const self = fileURLToPath(import.meta.url);
    const hits: string[] = [];
    for (const file of files) {
      if (file === self) continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of BANNED) {
        if (pattern.test(text)) hits.push(`${relative(repoRoot, file)}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
