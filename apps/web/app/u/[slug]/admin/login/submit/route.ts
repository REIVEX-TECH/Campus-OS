import { ADMIN_COOKIE, adminConfigured, issueAdminToken } from '@/lib/admin-auth';
import { checkAdminPassword } from '@/lib/admin-token';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { relativeRedirect } from '@/lib/redirects';
import { tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = `${tenantBaseForHost(request.headers.get('host') ?? '', slug)}/admin`;
  if (!adminConfigured()) {
    return relativeRedirect(`${base}/login`);
  }
  if (!rateLimit(`admin-login:${clientKey(new Headers(request.headers))}`, 5, 60_000)) {
    return relativeRedirect(`${base}/login?error=rate`);
  }

  const form = await request.formData();
  const secret = String(form.get('secret') ?? '');
  const adminSecret = process.env.ADMIN_SECRET ?? '';
  if (!secret || !checkAdminPassword(secret, adminSecret)) {
    return relativeRedirect(`${base}/login?error=invalid`);
  }

  const token = issueAdminToken(slug);
  const res = relativeRedirect(`${base}/rooms`);
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
