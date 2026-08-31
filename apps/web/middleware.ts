import { NextResponse, type NextRequest } from 'next/server';
import { relativeRedirect } from './lib/redirects';
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
    // Relative Location so the browser stays on the public origin (behind a
    // proxy the upstream host differs), not localhost:PORT.
    return relativeRedirect(`${plan.pathname}${url.search}`, 308);
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
