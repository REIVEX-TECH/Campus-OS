import { NextResponse, type NextRequest } from 'next/server';
import { subdomainOf } from '@campusos/core/tenant';

const APP_DOMAIN = process.env.APP_DOMAIN ?? 'localhost:3000';

/**
 * Resolve the tenant once, here, and pass it down explicitly via a request
 * header (no global mutable state). Subdomain tenancy is canonical; the
 * /u/{slug} path is a local-dev fallback. Unknown tenants are still routed to
 * the /u/[slug] page, which renders a proper 404 rather than crashing.
 */
export function middleware(req: NextRequest): NextResponse {
  const url = req.nextUrl;
  const host = req.headers.get('host') ?? '';
  const label = subdomainOf(host, APP_DOMAIN);

  if (label) {
    const rest = url.pathname === '/' ? '' : url.pathname;
    const rewrite = new URL(`/u/${label}${rest}`, url);
    rewrite.search = url.search;
    const headers = new Headers(req.headers);
    headers.set('x-tenant-slug', label);
    return NextResponse.rewrite(rewrite, { request: { headers } });
  }

  if (url.pathname.startsWith('/u/')) {
    const slug = url.pathname.split('/')[2] ?? '';
    const headers = new Headers(req.headers);
    if (slug) headers.set('x-tenant-slug', slug);
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
