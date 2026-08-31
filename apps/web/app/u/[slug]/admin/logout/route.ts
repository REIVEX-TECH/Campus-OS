import { ADMIN_COOKIE } from '@/lib/admin-auth';
import { relativeRedirect } from '@/lib/redirects';
import { tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = tenantBaseForHost(request.headers.get('host') ?? '', slug);
  const res = relativeRedirect(`${base}/admin/login`);
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
