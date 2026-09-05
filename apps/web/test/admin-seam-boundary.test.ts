import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The tenant-access seam is a boundary, not a convention: every admin surface
// must resolve its actor context through it (accessForPage / tenantAccess /
// tenantAccessContext), so the platform-grant path is applied uniformly and a
// new page cannot silently reintroduce a direct, grant-unaware permission gate.
//
// Piece 2 pins the READ pages under app/u/[slug]/admin/**: no requirePermission
// or currentPermissions. The write endpoints (the rename route handlers here and
// app/api/admin/**) still use the old gate and stay fail-closed until Piece 2c
// routes them through the seam and extends this test to forbid `permitted` and
// `withActor` too.
const adminRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'app',
  'u',
  '[slug]',
  'admin',
);

function collect(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
}

const files: string[] = [];
collect(adminRoot, files);

const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\brequirePermission\s*\(/, why: 'requirePermission bypasses the grant path' },
  { re: /\bcurrentPermissions\s*\(/, why: 'currentPermissions bypasses the grant path' },
];

describe('admin read surfaces go through the tenant-access seam', () => {
  it('finds the admin surfaces', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files)('%s resolves access through the seam', (file) => {
    const src = readFileSync(file, 'utf8');
    for (const { re, why } of FORBIDDEN) {
      expect(re.test(src), `${file}: ${why}; use accessForPage/tenantAccess`).toBe(false);
    }
  });
});
