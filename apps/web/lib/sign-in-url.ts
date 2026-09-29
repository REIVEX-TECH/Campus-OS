/**
 * Building and validating sign-in links, so a person sent to the sign-in page comes
 * back to where they were instead of a generic landing.
 *
 * Two concerns, both pure (no database, no request), so they are unit-testable and can be
 * imported from a client component:
 *
 * - `signInPath` builds `${base}/signin` with an optional `next` (where to return) and
 *   `reason` (why we are asking, for contextual copy).
 * - `safeReturnPath` validates a `next` before we redirect to it. A return target is
 *   attacker-influenced (it rides in the URL), so it must be a root-relative path within
 *   the current tenant, never an absolute or protocol-relative URL that would bounce the
 *   visitor to another origin.
 */

export const SIGN_IN_REASONS = ['reply', 'comment', 'message', 'post', 'save', 'vote'] as const;

export type SignInReason = (typeof SIGN_IN_REASONS)[number];

export function isSignInReason(value: string | undefined): value is SignInReason {
  return value !== undefined && (SIGN_IN_REASONS as readonly string[]).includes(value);
}

export function signInPath(
  base: string,
  opts: { next?: string | null; reason?: SignInReason } = {},
): string {
  const params = new URLSearchParams();
  if (opts.next) params.set('next', opts.next);
  if (opts.reason) params.set('reason', opts.reason);
  const query = params.toString();
  return query ? `${base}/signin?${query}` : `${base}/signin`;
}

/**
 * Return `next` only if it is a safe place to send the visitor after signing in: a
 * root-relative path that stays inside this tenant's base and is not the sign-in page
 * itself. Otherwise return null, so the caller falls back to its default landing.
 *
 * `base` is '' on a tenant subdomain (the whole origin is the tenant) and '/u/{slug}' on
 * the path-based fallback (only that prefix is the tenant).
 */
export function safeReturnPath(next: string | null | undefined, base: string): string | null {
  if (typeof next !== 'string' || next.length === 0) return null;
  // Root-relative only: reject absolute URLs, protocol-relative '//host', and any '\' the
  // browser would fold to '/' to escape the origin.
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  if (next.includes('\\')) return null;
  if (next.includes('://')) return null;

  // Stay inside the tenant. On a subdomain (base '') any root-relative path is same-tenant;
  // on the path-based fallback the path must live under '/u/{slug}'.
  if (base && next !== base && !next.startsWith(`${base}/`)) return null;

  // Never loop back to the sign-in page.
  const path = next.split('?')[0]!.split('#')[0]!;
  if (path === `${base}/signin`) return null;

  return next;
}
