import { describe, expect, it } from 'vitest';
import { InvalidIdentityTokenError } from '@campusos/core/auth';
import { GoogleIdentityVerifier, googleVerifierFromEnv } from '../src/auth/google-verifier';
import { hashToken } from '../src/sessions';

describe('googleVerifierFromEnv', () => {
  it('is absent when the deployment has no project configured', () => {
    // Sign in being unconfigured is a normal state, not an error: the public
    // site does not need an identity provider to serve a timetable.
    expect(googleVerifierFromEnv({})).toBeNull();
  });

  it('uses the server project id, falling back to the public one', () => {
    expect(googleVerifierFromEnv({ FIREBASE_PROJECT_ID: 'p' })).not.toBeNull();
    expect(googleVerifierFromEnv({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'p' })).not.toBeNull();
  });
});

describe('GoogleIdentityVerifier', () => {
  it('rejects an empty token without reaching the network', async () => {
    await expect(new GoogleIdentityVerifier('p').verify('')).rejects.toBeInstanceOf(
      InvalidIdentityTokenError,
    );
  });

  it('rejects a token that is not a signed JWT', async () => {
    await expect(new GoogleIdentityVerifier('p').verify('not-a-jwt')).rejects.toBeInstanceOf(
      InvalidIdentityTokenError,
    );
  });

  it('says nothing about why a token failed', async () => {
    // The reason would describe an attacker's own token back to them, so the
    // message is deliberately generic.
    const error = await new GoogleIdentityVerifier('p').verify('not-a-jwt').catch((e) => e);
    expect(String(error)).not.toContain('not-a-jwt');
  });
});

describe('hashToken', () => {
  it('is deterministic, so a token resolves to one row', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('separates different tokens', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('never returns the token itself, so a dump yields no live session', () => {
    const hash = hashToken('super-secret-token');
    expect(hash).not.toContain('super-secret-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
