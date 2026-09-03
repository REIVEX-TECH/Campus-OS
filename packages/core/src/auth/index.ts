/**
 * The boundary between CampusOS and whoever proves someone owns an email.
 *
 * The provider answers exactly one question: does this person control this
 * account, and what is their verified email. Everything that makes someone a
 * user of CampusOS (the record, the handle, roles, membership, sessions) lives
 * in our own database and never in the provider.
 *
 * Keeping that one question behind an interface is what makes the provider
 * replaceable (CLAUDE.md 2). Nothing outside the identity module's provider
 * implementation may import a vendor SDK.
 */

/** What a provider tells us, and the most we are willing to learn from it. */
export interface VerifiedIdentity {
  /**
   * The provider's stable identifier for this person. Stable across email
   * changes, which is why it, rather than the email, is the join key.
   */
  subject: string;
  email: string;
}

export interface IdentityTokenVerifier {
  /**
   * Verify a token minted by the provider for this deployment.
   *
   * Implementations must reject anything they cannot fully verify rather than
   * returning a partially trusted result: a bad signature, the wrong audience or
   * issuer, an expired token, or an unverified email are all failures.
   */
  verify(token: string): Promise<VerifiedIdentity>;
}

/**
 * Raised when a token cannot be trusted. Carries no detail from the token
 * itself, so a failure can be logged and shown without leaking its contents.
 */
export class InvalidIdentityTokenError extends Error {
  constructor(reason: string) {
    super(`identity token rejected: ${reason}`);
    this.name = 'InvalidIdentityTokenError';
  }
}

/**
 * Raised when sign in is not configured for this deployment. Distinct from a
 * rejected token: it means the operator has not set the provider up, so the
 * interface can say so plainly instead of failing as though the user did
 * something wrong.
 */
export class IdentityProviderNotConfiguredError extends Error {
  constructor() {
    super('identity provider is not configured');
    this.name = 'IdentityProviderNotConfiguredError';
  }
}
