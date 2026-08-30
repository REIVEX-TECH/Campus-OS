import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Belt-and-suspenders for the ESLint no-restricted-imports rule. App code must
// go through repositories (which set the tenant context so RLS applies) and must
// never import a data-source adapter (ingestion-only).
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

const BANNED_DB_CLIENT = /from\s+['"]@campusos\/db\/client['"]/;
const BANNED_ADAPTER = /from\s+['"]@campusos\/adapter-[^'"]+['"]/;

describe('app import guard', () => {
  it('no app source imports the raw db client', () => {
    const offenders = files.filter((file) => BANNED_DB_CLIENT.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no app source imports a data-source adapter', () => {
    const offenders = files.filter((file) => BANNED_ADAPTER.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
