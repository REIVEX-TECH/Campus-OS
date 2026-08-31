import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Hard rule 1 (docs/design.md): no dash punctuation in UI copy. We ban the em
// dash (U+2014), the en dash (U+2013), and the hyphen used as a connector (a
// hyphen with surrounding spaces). The PLAIN hyphen is allowed, so compounds
// (multi-tenant) and room codes (B-204) survive. Time ranges read "8:00 to 9:30".
//
// This scanner is the authoritative gate for the i18n copy catalog (messages/*)
// and covers app/JSX source for em/en dashes. The spaced-hyphen connector inside
// JSX text is additionally caught by the ESLint no-restricted-syntax rule
// (eslint.config.mjs), which sees real JSXText nodes and so cannot false-positive
// on arithmetic like `a - b`.
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function collect(dir: string, exts: string[], acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, exts, acc);
    else if (exts.some((e) => entry.endsWith(e))) acc.push(full);
  }
}

const EM_EN = /[–—]/;
const SPACED_HYPHEN = / - /;

function scan(files: string[], patterns: { re: RegExp; label: string }[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const { re, label } of patterns) {
          if (re.test(line))
            hits.push(`${relative(webRoot, file)}:${i + 1} [${label}] ${line.trim()}`);
        }
      });
  }
  return hits;
}

describe('no dash punctuation in UI copy', () => {
  it('messages/*.ts contain no em dash, en dash, or spaced hyphen connector', () => {
    const files: string[] = [];
    collect(join(webRoot, 'messages'), ['.ts'], files);
    expect(files.length).toBeGreaterThan(0);
    expect(
      scan(files, [
        { re: EM_EN, label: 'em/en dash' },
        { re: SPACED_HYPHEN, label: 'spaced hyphen connector' },
      ]),
    ).toEqual([]);
  });

  it('app/ and lib/ source contain no em dash or en dash', () => {
    const files: string[] = [];
    collect(join(webRoot, 'app'), ['.ts', '.tsx'], files);
    collect(join(webRoot, 'lib'), ['.ts', '.tsx'], files);
    expect(scan(files, [{ re: EM_EN, label: 'em/en dash' }])).toEqual([]);
  });
});
