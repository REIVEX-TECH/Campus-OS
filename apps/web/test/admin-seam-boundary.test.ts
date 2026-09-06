import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The tenant-access seam is a boundary, not a convention: every admin surface,
// read or write, resolves its actor context through it (accessForPage /
// tenantAccess / tenantAccessContext / tenantWriteContext), so the platform-grant
// path is applied uniformly and a new page or route cannot silently reintroduce a
// direct, grant-unaware permission gate.
//
// Piece 2 pinned the read pages; piece 2c extends this to the write endpoints
// (app/api/admin/** and the tenant-tree rename routes), forbidding the direct
// gates outright. A mutation that bypasses the seam would not carry the grant use
// row into the 0019 definers, so it must not exist.
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [join(webRoot, 'app', 'u', '[slug]', 'admin'), join(webRoot, 'app', 'api', 'admin')];

function collect(dir: string, acc: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
}

const files: string[] = [];
for (const root of roots) collect(root, files);

// The direct actor-context gates the seam replaces. None may appear in an admin
// surface: reads use accessForPage/tenantAccess, writes use tenantWriteContext,
// and the transaction context is entered inside identity module functions (which
// receive the seam's write access), never in the route itself.
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\brequirePermission\s*\(/, why: 'use accessForPage' },
  { re: /\bcurrentPermissions\s*\(/, why: 'use tenantAccess' },
  { re: /\bpermitted\s*\(/, why: 'use tenantWriteContext' },
  { re: /\bwithActor(InTenant)?\s*\(/, why: 'enter context via the module + seam access' },
  // No hand-rolled tenant context in a route: it would skip the grant/tenant
  // match the seam and withTenantMutation enforce. Module helpers may use these.
  { re: /\bwithTenant\s*\(/, why: 'enter context via the module + seam access' },
  { re: /\bwithGrantedTenant\s*\(/, why: 'enter the grant via the module + seam access' },
];

describe('admin surfaces go through the tenant-access seam', () => {
  it('finds both admin trees', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it.each(files)('%s resolves access through the seam', (file) => {
    const src = readFileSync(file, 'utf8');
    for (const { re, why } of FORBIDDEN) {
      expect(re.test(src), `${file}: bypasses the seam (${why})`).toBe(false);
    }
  });
});
