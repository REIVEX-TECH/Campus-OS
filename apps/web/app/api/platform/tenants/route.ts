import { z } from 'zod';
import { createTenant } from '@campusos/module-identity/tenants';
import { platformAdmin } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';
import { getTenantRegistry, invalidateTenantRegistry } from '@/lib/tenants';

/**
 * Create a university.
 *
 * Same origin and the per client limit first, on every caller; then 404 unless
 * the caller is a platform administrator, so the route is not an oracle for who
 * is one. The creation re-checks that inside its transaction and the row
 * policies check it again at the write. A slug or alias the registry already
 * resolves, from a file or a row, is refused before anything is written.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ config: z.unknown() });

/** Slug and aliases as the client sent them, before the module validates the rest. */
const keysSchema = z.object({
  slug: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`platform-tenant-create:${clientKey(request.headers)}`, 20, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await platformAdmin();
  if (!admin) return Response.json({ error: 'not_found' }, { status: 404 });

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success)
    return Response.json({ error: 'invalid', issues: ['config'] }, { status: 400 });

  const keys = keysSchema.safeParse(parsed.data.config);
  if (keys.success) {
    const registry = await getTenantRegistry();
    for (const key of [keys.data.slug, ...keys.data.aliases]) {
      if (registry.resolveBySlug(key)) return Response.json({ error: 'exists' }, { status: 409 });
    }
  }

  const result = await createTenant({ userId: admin.actor.userId }, parsed.data.config);
  if (!result.ok) {
    if (result.reason === 'exists') return Response.json({ error: 'exists' }, { status: 409 });
    if (result.reason === 'invalid') {
      return Response.json({ error: 'invalid', issues: result.issues }, { status: 400 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  invalidateTenantRegistry();
  return Response.json({ slug: result.config.slug, version: result.version });
}
