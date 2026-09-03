import { z } from 'zod';
import { getAdminRooms } from '@/lib/admin-rooms';
import { permitted } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { relativeRedirect } from '@/lib/redirects';
import { isSameOrigin } from '@/lib/same-origin';
import { tenantBaseForHost } from '@/lib/tenant-routing';

/**
 * Rename a building's display name. The code it was inferred from ("NB") is
 * never changed here, so later crawls still resolve to the same building.
 * Same gate as renaming a room: origin, a per client limit, then the permission
 * on the mutation itself, which is 404 without it.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const schema = z.object({ buildingId: z.string().uuid(), name: z.string().trim().min(1).max(80) });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = `${tenantBaseForHost(request.headers.get('host') ?? '', slug)}/admin/rooms`;

  if (!isSameOrigin(request.headers)) return new Response('Forbidden', { status: 403 });
  if (!rateLimit(`admin-rename-building:${clientKey(request.headers)}`, 60, 60_000)) {
    return new Response('Too Many Requests', { status: 429 });
  }
  if (!(await permitted(slug, 'manage-rooms'))) return new Response('Not Found', { status: 404 });

  const form = await request.formData();
  const parsed = schema.safeParse({ buildingId: form.get('buildingId'), name: form.get('name') });
  if (!parsed.success) return relativeRedirect(`${base}?error=1`);

  const updated = await getAdminRooms(slug).renameBuilding(
    parsed.data.buildingId,
    parsed.data.name,
  );
  if (!updated) return relativeRedirect(`${base}?error=1`);
  return relativeRedirect(`${base}?renamedBuilding=${encodeURIComponent(updated.name)}`);
}
