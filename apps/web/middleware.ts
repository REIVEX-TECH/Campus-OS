import { NextResponse, type NextRequest } from 'next/server';
import { planRoute } from './lib/tenant-routing';

/**
 * x-tenant-slug is set ONLY by this middleware and trusted downstream, so any
 * client-supplied value is stripped before we (re)set it from the route plan.
 */
function tenantHeaders(from: Headers, slug?: string): Headers {
  const headers = new Headers(from);
  headers.delete('x-tenant-slug');
  if (slug) headers.set('x-tenant-slug', slug);
  return headers;
}

/**
 * Resolve the tenant once, here, from the request host (a subdomain of
 * TENANT_BASE_DOMAIN) or the /u/{slug} path (dev fallback), and pass the slug
 * down via a request header. See lib/tenant-routing.ts for the (unit-tested)
 * decision logic. On a tenant subdomain, /u/{slug}/... is redirected to the
 * canonical clean URL; a request on the legacy {slug}.APP_DOMAIN host is
 * 308-redirected, cross-host, to {slug}.TENANT_BASE_DOMAIN.
 */
export function middleware(req: NextRequest): NextResponse {
  const url = req.nextUrl;
  const plan = planRoute(req.headers.get('host') ?? '', url.pathname);

  if (plan.action === 'redirect') {
    // Middleware requires an absolute URL. `req.nextUrl` is built from the
    // forwarded Host header (the public host), NOT the upstream socket, so this
    // is correct behind the proxy. (Route handlers use request.url, which IS the
    // socket, so they emit relative Locations instead; see lib/redirects.ts.)
    const to = new URL(url.href);
    if (plan.host) {
      // A legacy cross-host 308: the target is EXACTLY {slug}.TENANT_BASE_DOMAIN,
      // keeping the request scheme. Setting `.host` with a port-less value would
      // otherwise inherit the request's port, so clear it explicitly; a port in
      // plan.host (local dev, e.g. lgu.localhost:3100) is applied as-is.
      to.host = plan.host;
      if (!plan.host.includes(':')) to.port = '';
    }
    to.pathname = plan.pathname;
    to.search = url.search;
    return NextResponse.redirect(to, 308);
  }

  if (plan.action === 'rewrite') {
    const to = new URL(plan.pathname, url);
    to.search = url.search;
    return NextResponse.rewrite(to, {
      request: { headers: tenantHeaders(req.headers, plan.slug) },
    });
  }

  return NextResponse.next({ request: { headers: tenantHeaders(req.headers, plan.slug) } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
