import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Hand-authored Drizzle migrations are applied by migrate(), which reads ONLY the
// tags listed in each folder's meta/_journal.json. A .sql file with no journal
// entry is silently never applied (tsc and unit tests pass; CI later fails when
// the object "does not exist"); a journal entry with no .sql file breaks migrate
// outright. This pins the invariant for every module's migrations folder, so the
// class of "forgot the journal entry" fails here instead of in CI by luck.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Every `<pkg>/drizzle` that has a meta/_journal.json, discovered not hardcoded. */
function migrationFolders(): string[] {
  const parents = [join(repoRoot, 'packages'), join(repoRoot, 'packages', 'modules')];
  const found: string[] = [];
  for (const parent of parents) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = join(parent, entry.name, 'drizzle');
      if (existsSync(join(folder, 'meta', '_journal.json'))) found.push(folder);
    }
  }
  return found;
}

function journalTags(folder: string): string[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries?: { tag: string }[];
  };
  return (journal.entries ?? []).map((e) => e.tag).sort();
}

function sqlTags(folder: string): string[] {
  return readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();
}

describe('migration journal parity', () => {
  const folders = migrationFolders();

  it('discovers every module migrations folder', () => {
    // Guard against a pathing bug making the per-folder checks vacuous.
    expect(folders.length).toBeGreaterThanOrEqual(3);
  });

  it.each(folders)('%s: every .sql has a journal entry and vice versa', (folder) => {
    const sql = sqlTags(folder);
    const journal = journalTags(folder);
    const missingFromJournal = sql.filter((t) => !journal.includes(t));
    const missingSqlFile = journal.filter((t) => !sql.includes(t));
    expect(missingFromJournal, `${folder}: .sql files with no _journal.json entry`).toEqual([]);
    expect(missingSqlFile, `${folder}: _journal.json entries with no .sql file`).toEqual([]);
  });
});
