import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bridge guard for composed-review finding M2, until the side-table split lands.
 *
 * `tenant_memberships.standing_reason` and `appeal_note` are moderation text (why a
 * member was restricted, and their appeal). They still live on the tenant-wide-
 * readable membership row, so RLS admits any session in the tenant's context to
 * read them; the only thing confining them is that the gated readers are the only
 * code that selects them. That is exactly the "application's memory, not the
 * boundary" state M2 removes by moving them to an own-row side table (the M1 shape,
 * 0030). Until M2 ships, this scan keeps the residual GUARDED: any new reference to
 * these columns outside the known gated readers fails CI, so a leak cannot be
 * introduced and forgotten in the window. When M2 moves the columns, update the
 * allowlist to the new readers (or delete this test with the residual it guarded).
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const COLUMNS = [/standing_reason/, /appeal_note/, /standingReason/, /appealNote/];

// The only code allowed to name these columns today: the schema that declares
// them, the gated reader module (own-row standingFor, restrict-members
// listStandings, the appeal flow), and the app surface that shows a member their
// OWN standing. Paths are repo-relative, forward-slashed.
const ALLOWED = new Set([
  'packages/modules/identity/src/schema/identity.ts',
  'packages/modules/identity/src/standing.ts',
  'apps/web/app/_components/standing-notice.tsx',
  'apps/web/app/u/[slug]/layout.tsx',
]);

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
      try {
        if (statSync(join(repoRoot, src)).isDirectory()) found.push(src);
      } catch {
        /* no src dir */
      }
    }
  }
  return found;
}

const SCAN = [...moduleSrcDirs(), 'apps/web/app', 'apps/web/lib', 'tenants'];

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

describe('M2 bridge: standing moderation columns stay behind the gated readers', () => {
  it('no code outside the allowlist selects standing_reason / appeal_note', () => {
    const files: string[] = [];
    for (const rel of SCAN) collect(join(repoRoot, rel), files);
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(repoRoot, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of COLUMNS) {
        if (pattern.test(text)) hits.push(`${rel}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
