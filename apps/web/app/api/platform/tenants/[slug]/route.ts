import { z } from 'zod';
import { updateTenantConfig } from '@campusos/module-identity/tenants';
import { platformAdmin } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { getTenantRegistry, invalidateTenantRegistry } from '@/lib/tenants';

/**
 * Replace a university's configuration. Same gate as creating one. The slug
 * in the path is the one that changes; a config naming another is refused,
 * and an alias that already resolves to a different tenant is refused before
 * anything is written.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const bodySchema = z.object({ config: z.unknown() });
const aliasesSchema = z.object({ aliases: z.array(z.string()).default([]) });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`platform-tenant-update:${clientKey(request.headers)}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await platformAdmin();
  if (!admin) return Response.json({ error: 'not_found' }, { status: 404 });

  const { slug } = await params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success)
    return Response.json({ error: 'invalid', issues: ['config'] }, { status: 400 });

  const aliases = aliasesSchema.safeParse(parsed.data.config);
  if (aliases.success) {
    const registry = await getTenantRegistry();
    for (const alias of aliases.data.aliases) {
      const other = registry.resolveBySlug(alias);
      if (other && other.slug !== slug) return Response.json({ error: 'exists' }, { status: 409 });
    }
  }

  const result = await updateTenantConfig({ userId: admin.actor.userId }, slug, parsed.data.config);
  if (!result.ok) {
    if (result.reason === 'invalid' || result.reason === 'slug_mismatch') {
      return Response.json(
        { error: 'invalid', issues: result.reason === 'invalid' ? result.issues : ['slug'] },
        { status: 400 },
      );
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  invalidateTenantRegistry();
  return Response.json({ slug, version: result.version });
}
