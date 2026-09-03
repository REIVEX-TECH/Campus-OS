import { z } from 'zod';
import { getAdminRooms } from '@/lib/admin-rooms';
import { permitted } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { relativeRedirect } from '@/lib/redirects';
import { isSameOrigin } from '@/lib/same-origin';
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
  // The role on the mutation itself, not just the page in front of it. Without
  // it there is nothing here to find.
  if (!(await permitted(slug, 'manage-rooms'))) return new Response('Not Found', { status: 404 });

  const form = await request.formData();
  const parsed = schema.safeParse({ roomId: form.get('roomId'), name: form.get('name') });
  if (!parsed.success) {
    return relativeRedirect(`${base}?error=1`);
  }

  const updated = await getAdminRooms(slug).renameRoom(parsed.data.roomId, parsed.data.name);
  if (!updated) {
    return relativeRedirect(`${base}?error=1`);
  }
  return relativeRedirect(`${base}?renamed=${encodeURIComponent(updated.name)}`);
}
