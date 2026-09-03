import { z } from 'zod';
import { changeHandle } from '@campusos/module-identity/handles';
import { currentActor } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/same-origin';

/** Change your own handle. Only ever your own: the actor comes from the session. */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ handle: z.string().min(1).max(64) });

export async function POST(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'not_signed_in' }, { status: 401 });
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`handle:${clientKey(request.headers)}`, 20, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'format' }, { status: 400 });

  const result = await changeHandle(actor.userId, parsed.data.handle.trim());
  if (result.ok) return Response.json({ handle: result.handle });

  return Response.json(
    { error: result.reason, nextAllowedAt: result.nextAllowedAt?.toISOString() },
    // A rejected handle is a conflict or a rule, not a server fault.
    { status: result.reason === 'too_soon' ? 429 : 409 },
  );
}
