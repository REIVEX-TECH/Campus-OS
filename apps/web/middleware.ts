import { NextResponse, type NextRequest } from 'next/server';
import { planRoute } from './lib/tenant-routing';

/**
 * Resolve the tenant once, here, from the request host (subdomain) or the
 * /u/{slug} path (dev fallback), and pass the slug down via a request header.
 * See lib/tenant-routing.ts for the (unit-tested) decision logic. On a tenant
 * subdomain, /u/{slug}/... is redirected to the canonical clean URL so links and
 * form actions have exactly one shape per environment.
 */
export function middleware(req: NextRequest): NextResponse {
  const url = req.nextUrl;
  const plan = planRoute(req.headers.get('host') ?? '', url.pathname);

  if (plan.action === 'redirect') {
    // Middleware requires an absolute URL. `req.nextUrl` is built from the
    // forwarded Host header (the public host), NOT the upstream socket, so this
    // is correct behind the proxy. (Route handlers use request.url, which IS the
    // socket, so they emit relative Locations instead; see lib/redirects.ts.)
    const to = new URL(plan.pathname, url);
    to.search = url.search;
    return NextResponse.redirect(to, 308);
  }

  if (plan.action === 'rewrite') {
    const to = new URL(plan.pathname, url);
    to.search = url.search;
    const headers = new Headers(req.headers);
    headers.set('x-tenant-slug', plan.slug);
    return NextResponse.rewrite(to, { request: { headers } });
  }

  const headers = new Headers(req.headers);
  if (plan.slug) headers.set('x-tenant-slug', plan.slug);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
