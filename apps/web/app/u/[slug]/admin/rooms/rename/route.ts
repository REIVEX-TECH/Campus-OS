import { z } from 'zod';
import { isAdminAuthed } from '@/lib/admin-auth';
import { getAdminRooms } from '@/lib/admin-rooms';
import { relativeRedirect } from '@/lib/redirects';
import { tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const schema = z.object({ roomId: z.string().uuid(), name: z.string().min(1) });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = `${tenantBaseForHost(request.headers.get('host') ?? '', slug)}/admin/rooms`;

  // Server-side authorization on the mutation itself, not just the page.
  if (!(await isAdminAuthed(slug))) {
    return new Response('Unauthorized', { status: 401 });
  }

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
