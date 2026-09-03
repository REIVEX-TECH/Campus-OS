import { notFound, redirect } from 'next/navigation';
import { membershipFor } from '@campusos/module-identity/membership';
import { currentActor } from '@/lib/auth';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

/**
 * Bare tenant admin entry (`/admin` on a tenant host). Not a page in its own
 * right: it forwards. Admin is a role on an account, so signed out the way in
 * is the ordinary sign in, which everyone signed out is sent to alike; signed in
 * without the role there is nothing here to find, and holding it lands on the
 * verification queue, which links to the rest.
 */
export default async function AdminIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  requireTenant(slug); // unknown tenant -> 404, same as the rest of the tenant tree
  const base = await tenantBase(slug);

  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const membership = await membershipFor(actor.userId, slug);
  if (membership?.role === 'tenant_admin' && membership.status === 'active') {
    redirect(`${base}/admin/verification`);
  }
  notFound();
}
