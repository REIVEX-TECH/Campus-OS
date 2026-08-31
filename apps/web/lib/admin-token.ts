import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Pure admin-token logic, with no Next.js dependency, so it is unit testable.
// The token is an HMAC of the tenant slug keyed by the configured ADMIN_SECRET:
// holding a valid token proves knowledge of the secret for THAT tenant, and it
// cannot be forged without the secret. See lib/admin-auth.ts for the server glue.
//
// STOPGAP: this is a minimal shared-secret gate for the admin area until the
// identity module lands. It is real server-side enforcement (see the route
// handlers and requireAdmin), not a hidden URL, but it is intentionally simple.

const TOKEN_VERSION = 'v1';

export function signAdminToken(slug: string, adminSecret: string): string {
  return createHmac('sha256', adminSecret).update(`${TOKEN_VERSION}:${slug}`).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Does `token` prove admin knowledge of the secret for this tenant? */
export function verifyAdminToken(
  token: string | undefined,
  slug: string,
  adminSecret: string,
): boolean {
  if (!token) return false;
  return safeEqualHex(token, signAdminToken(slug, adminSecret));
}

/** Constant-time comparison of a submitted password to the admin secret. */
export function checkAdminPassword(submitted: string, adminSecret: string): boolean {
  const a = createHash('sha256').update(submitted).digest();
  const b = createHash('sha256').update(adminSecret).digest();
  return timingSafeEqual(a, b);
}
