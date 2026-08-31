import { NextResponse } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/admin-auth';
import { tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = tenantBaseForHost(request.headers.get('host') ?? '', slug);
  const res = NextResponse.redirect(new URL(`${base}/admin/login`, request.url), 303);
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
