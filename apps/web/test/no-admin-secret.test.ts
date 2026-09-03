import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Admin is a role on an account, never a secret.
 *
 * The shared ADMIN_SECRET password and its signed cookie were retired once the
 * account based tenant_admin role could reach everything they gated. This scan
 * keeps them retired: no source file, env template, deploy document or process
 * definition may mention the secret, the cookie, or the helpers that read them.
 * A future "quick" bypass would have to delete this test to land.
 *
 * The deploy config is scanned because it was the one place the secret survived
 * the first pass: pm2 went on forwarding ADMIN_SECRET, and its comment still
 * told the next reader the app read it. Nothing consumed it, so nothing broke
 * and nothing said so.
 *
 * docs/pr/ is deliberately NOT scanned. Those files are the record of what each
 * change did at the time, and several describe the secret while it existed;
 * rewriting them would be falsifying history rather than retiring a secret.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const BANNED = [
  /ADMIN_SECRET\b/,
  /ADMIN_SESSION_SECRET\b/,
  /campusos_admin\b/,
  /isAdminAuthed|requireAdmin\b|adminConfigured|issueAdminToken|verifyAdminToken|checkAdminPassword/,
];

const SCAN = [
  'apps/web/app',
  'apps/web/lib',
  'apps/web/middleware.ts',
  'packages',
  'tenants',
  'scripts',
  '.env.example',
  'docs/DEPLOY.md',
  'docs/DEPLOY-VPS.md',
  'README.md',
  'ecosystem.config.cjs',
];

function collect(path: string, acc: string[]): void {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      collect(join(path, entry), acc);
    }
  } else if (/\.(ts|tsx|mjs|cjs|sql|md|example)$/.test(path)) {
    acc.push(path);
  }
}

describe('no admin secret', () => {
  it('mentions neither the retired secret nor the helpers that read it', () => {
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
