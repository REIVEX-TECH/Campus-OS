import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Belt-and-suspenders for the ESLint no-restricted-imports rule: scan app source
// for any import of the raw db client. App code must go through repositories,
// which set the tenant context so RLS applies.
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
}

const files: string[] = [];
for (const rel of ['app', 'lib']) {
  try {
    collect(join(webRoot, rel), files);
  } catch {
    // directory may not exist yet
  }
}
try {
  const mw = join(webRoot, 'middleware.ts');
  statSync(mw);
  files.push(mw);
} catch {
  // optional
}

const BANNED = /from\s+['"]@campusos\/db\/client['"]/;

describe('no raw db client import in app', () => {
  it('no app source imports @campusos/db/client', () => {
    const offenders = files.filter((file) => BANNED.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
