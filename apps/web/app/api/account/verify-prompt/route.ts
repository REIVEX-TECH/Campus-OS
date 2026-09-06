import { z } from 'zod';
import { dismissVerifyPrompt } from '@campusos/module-identity/verification';
import { getTenantRegistry } from '@/lib/tenants';
import { currentActor } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Dismiss the "get verified" prompt for a tenant, for this account.
 *
 * A person's own low-stakes preference, remembered per account so the gentle
 * prompt never nags again. Runs as the person (RLS keeps it to their own row);
 * the cheap checks come first.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ tenant: z.string().min(1).max(64) });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`verify-prompt:${clientKey(request.headers)}`, 20, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'format' }, { status: 400 });

  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });

  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  if (!tenant) return Response.json({ error: 'unknown_tenant' }, { status: 404 });

  await dismissVerifyPrompt(actor.userId, tenant.slug);
  return Response.json({ ok: true });
}
