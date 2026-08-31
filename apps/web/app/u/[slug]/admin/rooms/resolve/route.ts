import { z } from 'zod';
import { isAdminAuthed } from '@/lib/admin-auth';
import { getAdminRooms } from '@/lib/admin-rooms';
import { relativeRedirect } from '@/lib/redirects';
import { tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const schema = z.object({
  rawValue: z.string().min(1),
  mode: z.enum(['new', 'existing']),
  newRoomName: z.string().optional(),
  existingRoomId: z.string().uuid().optional(),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = `${tenantBaseForHost(request.headers.get('host') ?? '', slug)}/admin/rooms`;

  // Server-side authorization on the mutation itself, not just the page.
  if (!(await isAdminAuthed(slug))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const parsed = schema.safeParse({
    rawValue: form.get('rawValue'),
    mode: form.get('mode'),
    newRoomName: form.get('newRoomName') || undefined,
    existingRoomId: form.get('existingRoomId') || undefined,
  });
  if (!parsed.success) {
    return relativeRedirect(`${base}?error=1`);
  }

  const { rawValue, mode, newRoomName, existingRoomId } = parsed.data;
  try {
    const repo = getAdminRooms(slug);
    const input =
      mode === 'existing' && existingRoomId
        ? { rawValue, existingRoomId }
        : { rawValue, newRoomName: newRoomName ?? rawValue };
    const result = await repo.resolveRoom(input);
    return relativeRedirect(
      `${base}?resolved=${result.resolvedEntries}&name=${encodeURIComponent(result.roomName)}`,
    );
  } catch {
    return relativeRedirect(`${base}?error=1`);
  }
}
