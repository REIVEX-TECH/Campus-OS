import { getTenantRegistry } from '@/lib/tenants';
import { icsResponse } from '@/lib/ics-response';
import { getQueries } from '@/lib/timetable';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; teacherId: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { slug, teacherId } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return new Response('Not found', { status: 404 });

  const queries = getQueries(slug);
  const teacher = await queries.getTeacher(teacherId);
  if (!teacher) return new Response('Not found', { status: 404 });

  const views = await queries.teacherTimetable(teacherId);
  return icsResponse({
    tenant,
    views,
    term: null,
    calendarName: `${tenant.displayName}, ${teacher.name}`,
  });
}
