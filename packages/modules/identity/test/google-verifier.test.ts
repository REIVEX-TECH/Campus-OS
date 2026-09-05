import { describe, expect, it } from 'vitest';
import { InvalidIdentityTokenError } from '@campusos/core/auth';
import { identityFromClaims } from '../src/auth/google-verifier';

/**
 * The claim rules that decide who is signing in.
 *
 * These run after jose has checked the signature, audience, issuer and expiry,
 * so every payload here is assumed already authentic. What is left is the part
 * that matters to authorisation: which provider minted it, and whether the
 * address it carries was verified.
 */
const google = (over: Record<string, unknown> = {}) => ({
  sub: 'google-subject-1',
  email: 'Someone@LGU.edu.pk',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
  ...over,
});

describe('identityFromClaims', () => {
  it('accepts a Google token and lower cases the address', () => {
    expect(identityFromClaims(google())).toEqual({
      subject: 'google-subject-1',
      email: 'someone@lgu.edu.pk',
    });
  });

  it('refuses every other Firebase provider', () => {
    // A verified address drives domain self-verification and the platform
    // bootstrap, so a second provider able to assert a verified address would be a
    // second door into them. Enabling one in the Firebase console must not quietly
    // open it.
    for (const provider of ['password', 'anonymous', 'github.com', 'custom', 'facebook.com']) {
      expect(() =>
        identityFromClaims(google({ firebase: { sign_in_provider: provider } })),
      ).toThrow(InvalidIdentityTokenError);
    }
  });

  it('refuses a token with no provider claim at all', () => {
    expect(() => identityFromClaims(google({ firebase: undefined }))).toThrow(
      InvalidIdentityTokenError,
    );
    expect(() => identityFromClaims(google({ firebase: {} }))).toThrow(InvalidIdentityTokenError);
  });

  it('refuses an unverified address, however it is spelled', () => {
    for (const value of [false, undefined, 'true', 1, null]) {
      expect(() => identityFromClaims(google({ email_verified: value }))).toThrow(
        InvalidIdentityTokenError,
      );
    }
  });

  it('refuses a token with no usable subject or address', () => {
    expect(() => identityFromClaims(google({ sub: undefined }))).toThrow(InvalidIdentityTokenError);
    expect(() => identityFromClaims(google({ sub: '' }))).toThrow(InvalidIdentityTokenError);
    expect(() => identityFromClaims(google({ email: undefined }))).toThrow(
      InvalidIdentityTokenError,
    );
    expect(() => identityFromClaims(google({ email: '' }))).toThrow(InvalidIdentityTokenError);
  });
});
