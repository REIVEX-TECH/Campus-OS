import { redirect } from 'next/navigation';
import { isAdminAuthed } from '@/lib/admin-auth';
import { tenantAdmin } from '@/lib/auth';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

/**
 * Bare tenant admin entry (`/admin` on a tenant host). Not a page in its own
 * right: it forwards to the room-mapping admin when already authed, otherwise to
 * the login. Makes `/admin` a valid entry point instead of a 404 (the actual
 * pages live at /admin/login and /admin/rooms).
 */
export default async function AdminIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  requireTenant(slug); // unknown tenant -> 404, same as the rest of the tenant tree
  const base = await tenantBase(slug);
  if (await isAdminAuthed(slug)) redirect(`${base}/admin/rooms`);
  // A tenant admin by membership has no secret and needs none.
  if (await tenantAdmin(slug)) redirect(`${base}/admin/verification`);
  redirect(`${base}/admin/login`);
}
