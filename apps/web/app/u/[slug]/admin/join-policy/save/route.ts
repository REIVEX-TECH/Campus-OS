import { setJoinPolicy } from '@campusos/module-identity/tenants';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { relativeRedirect } from '@/lib/redirects';
import { isSameOrigin } from '@/lib/same-origin';
import { tenantWriteContext } from '@/lib/tenant-access';
import { tenantBaseForHost } from '@/lib/tenant-routing';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/** Split a textarea of domains (newline or comma separated) into a clean list. */
function parseDomains(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug } = await params;
  const base = `${tenantBaseForHost(request.headers.get('host') ?? '', slug)}/admin/join-policy`;

  if (!isSameOrigin(request.headers)) return new Response('Forbidden', { status: 403 });
  if (!rateLimit(`admin-join-policy:${clientKey(request.headers)}`, 30, 60_000)) {
    return new Response('Too Many Requests', { status: 429 });
  }
  // The role on the mutation itself, resolved through the seam so a platform grant
  // into this tenant carries manage-members. The write is a definer
  // (auth_set_join_policy) that re-checks authority on the unforgeable grant
  // use-row, refuses consumer providers, and audits the change itself.
  const write = await tenantWriteContext(slug, 'manage-members');
  if (!write) return new Response('Not Found', { status: 404 });

  const form = await request.formData();
  const result = await setJoinPolicy(
    write.actor,
    slug,
    {
      joinMode: String(form.get('joinMode') ?? ''),
      allowedEmailDomains: parseDomains(String(form.get('allowedEmailDomains') ?? '')),
    },
    write.access,
  );

  if (result.ok) return relativeRedirect(`${base}?saved=1`);
  if (result.error.reason === 'blocked_domain') {
    return relativeRedirect(`${base}?blocked=${encodeURIComponent(result.error.domain)}`);
  }
  return relativeRedirect(`${base}?error=1`);
}
