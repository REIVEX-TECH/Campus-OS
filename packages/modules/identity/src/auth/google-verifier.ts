import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  IdentityProviderNotConfiguredError,
  InvalidIdentityTokenError,
  type IdentityTokenVerifier,
  type VerifiedIdentity,
} from '@campusos/core/auth';

/**
 * Verifies a Firebase-issued Google sign in token, server side.
 *
 * Firebase is the front door and nothing more: it proves the person controls a
 * Google account and hands back a signed token. This checks that signature
 * against Google's published keys and reads two claims from it, the subject and
 * the verified email. Nothing else about the token is kept, and the provider
 * holds nothing about the user.
 *
 * Deliberately not the Firebase Admin SDK. Verification needs only Google's
 * public keys and the project id, which is itself public, so there is no service
 * account key to hold, rotate, or leak. That is a smaller dependency and one
 * fewer secret.
 */

/** Google's public keys for Firebase-issued tokens. */
const JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

/** Cached across requests: the set refreshes itself as Google rotates keys. */
const remoteKeys = createRemoteJWKSet(JWKS_URL);

interface FirebaseClaims {
  email?: unknown;
  email_verified?: unknown;
  firebase?: { sign_in_provider?: unknown };
}

/**
 * The one provider this deployment accepts.
 *
 * Firebase issues tokens for every method a project has enabled, all signed by
 * the same keys and all carrying `email_verified`. Admin is granted by matching
 * an address against the tenant's `adminEmails`, so any other enabled provider
 * that could assert a verified address would be a second door into the admin
 * area. Only Google is offered in the UI, so only Google is accepted here, and
 * enabling another method in the Firebase console cannot quietly open one.
 */
const SIGN_IN_PROVIDER = 'google.com';

/**
 * Read a verified identity out of already-verified token claims.
 *
 * Split from `verify` so the claim rules can be tested directly: the signature
 * check needs Google's keys, these rules need nothing and carry the weight.
 */
export function identityFromClaims(payload: {
  sub?: unknown;
  [claim: string]: unknown;
}): VerifiedIdentity {
  const subject = payload.sub;
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new InvalidIdentityTokenError('no subject');
  }

  const { email, email_verified: emailVerified, firebase } = payload as FirebaseClaims;
  if (firebase?.sign_in_provider !== SIGN_IN_PROVIDER) {
    throw new InvalidIdentityTokenError('unexpected sign in provider');
  }
  if (typeof email !== 'string' || email.length === 0) {
    throw new InvalidIdentityTokenError('no email');
  }
  // An unverified address proves nothing about who is signing in, and the
  // whole membership model keys off the email domain, so it is refused here
  // rather than anywhere later.
  if (emailVerified !== true) throw new InvalidIdentityTokenError('email not verified');

  return { subject, email: email.toLowerCase() };
}

export class GoogleIdentityVerifier implements IdentityTokenVerifier {
  constructor(private readonly projectId: string) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    if (!this.projectId) throw new IdentityProviderNotConfiguredError();
    if (!token) throw new InvalidIdentityTokenError('empty token');

    let payload;
    try {
      // jose checks the signature, algorithm, expiry and not-before. Audience
      // and issuer are pinned to this project, so a token minted for a different
      // Firebase project cannot be replayed here.
      ({ payload } = await jwtVerify(token, remoteKeys, {
        algorithms: ['RS256'],
        audience: this.projectId,
        issuer: `https://securetoken.google.com/${this.projectId}`,
      }));
    } catch {
      // The reason is deliberately not echoed back: it would describe an
      // attacker's token to them.
      throw new InvalidIdentityTokenError('signature, audience, issuer or expiry');
    }

    return identityFromClaims(payload);
  }
}

/**
 * The verifier for this deployment, or null when sign in has not been set up.
 *
 * Returning null rather than throwing lets the sign in page say "not configured"
 * plainly, and lets everything else keep working: the public site does not need
 * an identity provider to serve a timetable.
 */
export function googleVerifierFromEnv(
  env: Record<string, string | undefined> = process.env,
): IdentityTokenVerifier | null {
  const projectId = env.FIREBASE_PROJECT_ID ?? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  return projectId ? new GoogleIdentityVerifier(projectId) : null;
}
