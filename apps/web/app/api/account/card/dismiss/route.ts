import { z } from 'zod';
import { dismissCard } from '@campusos/module-identity/cards';
import { CONTEXTUAL_CARDS } from '@/lib/cards';
import { getTenantRegistry } from '@/lib/tenants';
import { currentActor } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Dismiss a contextual home card for this account. The person's own low-stakes
 * preference (RLS keeps it to their own row); the card stays hidden for 24h. The
 * card id is validated against the catalog so only real cards can be dismissed.
 */
export const dynamic = 'force-dynamic';

const KNOWN_CARDS = CONTEXTUAL_CARDS.map((c) => c.id);
const bodySchema = z.object({
  tenant: z.string().min(1).max(64),
  card: z.string().refine((id) => KNOWN_CARDS.includes(id), { message: 'unknown_card' }),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`card-dismiss:${clientKey(request.headers)}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'format' }, { status: 400 });

  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });

  const tenant = (await getTenantRegistry()).resolveBySlug(parsed.data.tenant);
  if (!tenant) return Response.json({ error: 'unknown_tenant' }, { status: 404 });

  await dismissCard(actor.userId, tenant.slug, parsed.data.card);
  return Response.json({ ok: true });
}
