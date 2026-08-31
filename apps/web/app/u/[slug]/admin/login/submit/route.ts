import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, adminConfigured, issueAdminToken } from '@/lib/admin-auth';
import { checkAdminPassword } from '@/lib/admin-token';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = `${tenantBaseForHost(request.headers.get('host') ?? '', slug)}/admin`;
  if (!adminConfigured()) {
    return NextResponse.redirect(new URL(`${base}/login`, request.url), 303);
  }
  if (!rateLimit(`admin-login:${clientKey(new Headers(request.headers))}`, 5, 60_000)) {
    return NextResponse.redirect(new URL(`${base}/login?error=rate`, request.url), 303);
  }

  const form = await request.formData();
  const secret = String(form.get('secret') ?? '');
  const adminSecret = process.env.ADMIN_SECRET ?? '';
  if (!secret || !checkAdminPassword(secret, adminSecret)) {
    return NextResponse.redirect(new URL(`${base}/login?error=invalid`, request.url), 303);
  }

  const token = issueAdminToken(slug);
  const res = NextResponse.redirect(new URL(`${base}/rooms`, request.url), 303);
  if (token) {
    res.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    });
  }
  return res;
}
