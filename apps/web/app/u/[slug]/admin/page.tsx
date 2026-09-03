import { notFound, redirect } from 'next/navigation';
import { firstAdminSection } from '@/lib/admin-sections';
import { currentPermissions } from '@/lib/auth';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

/**
 * Bare tenant admin entry (`/admin` on a tenant host). Not a page in its own
 * right: it forwards. Admin is a set of permissions on an account, so signed
 * out the way in is the ordinary sign in, which everyone signed out is sent to
 * alike; signed in with none of them there is nothing here to find, and holding
 * any lands on the first section that permission opens.
 */
export default async function AdminIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireTenant(slug); // unknown tenant -> 404, same as the rest of the tenant tree
  const base = await tenantBase(slug);

  const permissions = await currentPermissions(slug);
  if (!permissions) redirect(`${base}/signin`);
  const first = firstAdminSection(permissions);
  if (first) redirect(`${base}${first.path}`);
  notFound();
}
