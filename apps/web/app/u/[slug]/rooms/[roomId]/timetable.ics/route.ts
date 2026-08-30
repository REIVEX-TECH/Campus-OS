import { tenantRegistry } from '@campusos/tenants';
import { icsResponse } from '@/lib/ics-response';
import { getQueries } from '@/lib/timetable';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; roomId: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { slug, roomId } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return new Response('Not found', { status: 404 });

  const queries = getQueries(slug);
  const room = await queries.getRoom(roomId);
  if (!room) return new Response('Not found', { status: 404 });

  const views = await queries.roomTimetable(roomId);
  return icsResponse({
    tenant,
    views,
    term: null,
    calendarName: `${tenant.displayName} — ${room.name}`,
  });
}
