import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { signAdminToken, verifyAdminToken } from './admin-token';

// Server-side admin gate. Enforced on every admin page (requireAdmin) AND every
// admin mutation (assertAdmin in the route handlers), so the protection is real,
// not a hidden URL or a client-only control. Fails CLOSED: with no ADMIN_SECRET
// configured, nothing authenticates and all admin access is denied.
//
// STOPGAP until the identity module: a single shared secret, set via env and
// exchanged for a per-tenant signed cookie at /admin/login.

export const ADMIN_COOKIE = 'campusos_admin';

function adminSecret(): string | null {
  const s = process.env.ADMIN_SECRET;
  return s && s.length > 0 ? s : null;
}

export function adminConfigured(): boolean {
  return adminSecret() !== null;
}

export function issueAdminToken(slug: string): string | null {
  const s = adminSecret();
  return s ? signAdminToken(slug, s) : null;
}

/** Read the admin cookie and verify it for this tenant. */
export async function isAdminAuthed(slug: string): Promise<boolean> {
  const s = adminSecret();
  if (!s) return false;
  const jar = await cookies();
  return verifyAdminToken(jar.get(ADMIN_COOKIE)?.value, slug, s);
}

/** For server components: redirect to the tenant admin login unless authed. */
export async function requireAdmin(slug: string): Promise<void> {
  if (!(await isAdminAuthed(slug))) redirect(`/u/${slug}/admin/login`);
}
