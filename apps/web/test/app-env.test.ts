import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { assertAppEnv } from '@/lib/app-env';
import manifest from '@/lib/app-env.vars.json';

const require = createRequire(import.meta.url);

/** A production process env with every required var satisfied, plus overrides. */
function baseEnv(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://x',
    TENANT_BASE_DOMAIN: 'campusos.reivex.io',
    PLATFORM_HOST: 'campusos.reivex.io',
    APP_DOMAIN: 'campusos.reivex.io',
    ...over,
  };
}

/** Write a throwaway .env and return its path; caller cleans the dir. */
function tempEnv(contents: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'app-env-'));
  const path = join(dir, '.env');
  writeFileSync(path, contents, 'utf8');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('assertAppEnv', () => {
  it('passes when required vars are present and no .env to compare', () => {
    expect(() => assertAppEnv({ env: baseEnv(), dotenvPath: null })).not.toThrow();
  });

  it('throws naming a required var that is missing', () => {
    expect(() => assertAppEnv({ env: { NODE_ENV: 'production' }, dotenvPath: null })).toThrow(
      /DATABASE_URL is REQUIRED/,
    );
  });

  it('treats an empty required var as missing', () => {
    expect(() => assertAppEnv({ env: baseEnv({ DATABASE_URL: '   ' }), dotenvPath: null })).toThrow(
      /DATABASE_URL is REQUIRED/,
    );
  });

  it('requires the base/host vars in production (a missing one crashes the boot)', () => {
    for (const name of ['TENANT_BASE_DOMAIN', 'PLATFORM_HOST', 'APP_DOMAIN']) {
      expect(() => assertAppEnv({ env: baseEnv({ [name]: undefined }), dotenvPath: null })).toThrow(
        new RegExp(`${name} is REQUIRED in production`),
      );
    }
  });

  it('does NOT require the host vars in development', () => {
    // Dev leaves PLATFORM_HOST empty and the host vars fall back to localhost.
    expect(() =>
      assertAppEnv({
        env: { NODE_ENV: 'development', DATABASE_URL: 'postgres://x' },
        dotenvPath: null,
      }),
    ).not.toThrow();
  });

  it('flags a var set in .env that did not reach the process (the recurring bug)', () => {
    const { path, cleanup } = tempEnv('SUPERADMIN_EMAILS=me@example.com\n');
    try {
      expect(() =>
        assertAppEnv({
          env: baseEnv({ SUPERADMIN_EMAILS: undefined }),
          dotenvPath: path,
        }),
      ).toThrow(/SUPERADMIN_EMAILS is set in .* but did NOT reach the process/);
    } finally {
      cleanup();
    }
  });

  it('does not flag a var that reached the process', () => {
    const { path, cleanup } = tempEnv('SUPERADMIN_EMAILS=me@example.com\n');
    try {
      expect(() =>
        assertAppEnv({
          env: baseEnv({ SUPERADMIN_EMAILS: 'me@example.com' }),
          dotenvPath: path,
        }),
      ).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it('does not flag a var left intentionally empty in .env', () => {
    const { path, cleanup } = tempEnv('SUPERADMIN_EMAILS=\nPLATFORM_HOST=\n');
    try {
      expect(() => assertAppEnv({ env: baseEnv(), dotenvPath: path })).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it('skips the forwarding comparison outside production', () => {
    const { path, cleanup } = tempEnv('SUPERADMIN_EMAILS=me@example.com\n');
    try {
      // NODE_ENV=development, var not forwarded — must NOT throw (Next loads
      // .env itself in dev, so there is no forwarding layer to verify).
      expect(() =>
        assertAppEnv({
          env: { NODE_ENV: 'development', DATABASE_URL: 'postgres://x' },
          dotenvPath: path,
        }),
      ).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it('ignores .env keys that are not in the manifest', () => {
    // MIGRATION_DATABASE_URL (owner creds) is intentionally never forwarded, so
    // its presence in .env must not be treated as a forwarding gap.
    const { path, cleanup } = tempEnv('MIGRATION_DATABASE_URL=postgres://owner\n');
    try {
      expect(() => assertAppEnv({ env: baseEnv(), dotenvPath: path })).not.toThrow();
    } finally {
      cleanup();
    }
  });
});

describe('app-env manifest', () => {
  it('requires DATABASE_URL always and the base/host vars in production; excludes owner/build vars', () => {
    const vars = manifest.vars as Array<{
      name: string;
      required?: boolean;
      requiredInProduction?: boolean;
    }>;
    const names = vars.map((v) => v.name);
    const always = vars.filter((v) => v.required).map((v) => v.name);
    const inProd = vars.filter((v) => v.requiredInProduction).map((v) => v.name);
    expect(always).toEqual(['DATABASE_URL']);
    expect(inProd.sort()).toEqual(['APP_DOMAIN', 'PLATFORM_HOST', 'TENANT_BASE_DOMAIN']);
    expect(names).not.toContain('MIGRATION_DATABASE_URL');
    expect(names).not.toContain('NEXT_PUBLIC_FIREBASE_API_KEY');
  });

  it('ecosystem.config.cjs forwards exactly the manifest set (+ NODE_ENV)', () => {
    // Structural guard: the pm2 forward-list is built from the manifest, so a
    // var declared in one place but not the other fails here rather than
    // silently in production.
    const config = require('../../../ecosystem.config.cjs');
    const forwarded = Object.keys(config.apps[0].env).sort();
    const expected = ['NODE_ENV', ...manifest.vars.map((v) => v.name)].sort();
    expect(forwarded).toEqual(expected);
  });
});
