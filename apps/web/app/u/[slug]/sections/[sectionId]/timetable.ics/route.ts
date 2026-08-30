import { tenantRegistry } from '@campusos/tenants';
import { icsResponse } from '@/lib/ics-response';
import { getQueries } from '@/lib/timetable';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; sectionId: string }> };

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { slug, sectionId } = await params;
  const tenant = tenantRegistry.resolveBySlug(slug);
  if (!tenant) return new Response('Not found', { status: 404 });

  const queries = getQueries(slug);
  const section = await queries.getSection(sectionId);
  if (!section) return new Response('Not found', { status: 404 });

  const [views, term] = await Promise.all([
    queries.sectionTimetable(sectionId),
    queries.getTerm(section.termId),
  ]);

  return icsResponse({
    tenant,
    views,
    term,
    calendarName: `${tenant.displayName} — ${section.program.code}-${section.name}`,
  });
}
