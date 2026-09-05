import { z } from 'zod';
import { auditTenantAdminAction } from '@campusos/module-identity/grants';
import { getAdminRooms } from '@/lib/admin-rooms';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { relativeRedirect } from '@/lib/redirects';
import { isSameOrigin } from '@/lib/same-origin';
import { tenantWriteContext } from '@/lib/tenant-access';
import { tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const schema = z.object({ roomId: z.string().uuid(), name: z.string().min(1) });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = `${tenantBaseForHost(request.headers.get('host') ?? '', slug)}/admin/rooms`;

  if (!isSameOrigin(request.headers)) return new Response('Forbidden', { status: 403 });
  if (!rateLimit(`admin-rename:${clientKey(request.headers)}`, 60, 60_000)) {
    return new Response('Too Many Requests', { status: 429 });
  }
  // The role on the mutation itself, not just the page in front of it, resolved
  // through the seam so a platform grant into this tenant carries manage-rooms.
  // Room writes are tenant-isolated (getAdminRooms sets the tenant context), so
  // the grant-aware gate is the authorisation; there is no 0019 definer here.
  const write = await tenantWriteContext(slug, 'manage-rooms');
  if (!write) return new Response('Not Found', { status: 404 });

  const form = await request.formData();
  const parsed = schema.safeParse({ roomId: form.get('roomId'), name: form.get('name') });
  if (!parsed.success) {
    return relativeRedirect(`${base}?error=1`);
  }

  const updated = await getAdminRooms(slug).renameRoom(parsed.data.roomId, parsed.data.name);
  if (!updated) {
    return relativeRedirect(`${base}?error=1`);
  }
  // A room write has no 0019 definer to audit it, so under a grant leave the
  // grant-attributable trail by hand: this stamps the use row and a grant-stamped
  // audit line, so god-mode room renames are never invisible.
  if (write.access.via === 'grant') {
    await auditTenantAdminAction(write.actor.userId, slug, write.access, {
      action: 'rooms.room_renamed',
      targetType: 'room',
      targetId: parsed.data.roomId,
    });
  }
  return relativeRedirect(`${base}?renamed=${encodeURIComponent(updated.name)}`);
}
