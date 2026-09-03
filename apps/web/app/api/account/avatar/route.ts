import { z } from 'zod';
import {
  AVATAR_OPTION_MAX,
  avatarOptionPage,
  avatarOptionSeed,
} from '@campusos/module-identity/avatar-seed';
import { chooseAvatar } from '@campusos/module-identity/handles';
import { currentActor } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Your own avatar: a page of options to choose from, and the choice.
 *
 * Only the option NUMBER crosses the wire. The seed that draws the picture is
 * built on the server from that number and the caller's own id, so a saved
 * avatar is always one of this person's own options rather than an arbitrary
 * string a browser made up.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ option: z.number().int().min(0).max(AVATAR_OPTION_MAX) });

/** A page of options to choose from. */
export async function GET(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'not_signed_in' }, { status: 401 });

  const raw = Number(new URL(request.url).searchParams.get('page') ?? '0');
  const page = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  return Response.json({
    page,
    options: avatarOptionPage(page).map((option) => ({
      option,
      seed: avatarOptionSeed(actor.userId, option),
    })),
  });
}

/** Keep one. */
export async function POST(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'not_signed_in' }, { status: 401 });
  if (!isSameOrigin(request.headers)) return Response.json({ error: 'origin' }, { status: 403 });
  if (!rateLimit(`avatar:${clientKey(request.headers)}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'format' }, { status: 400 });

  return Response.json({ avatarSeed: await chooseAvatar(actor.userId, parsed.data.option) });
}
