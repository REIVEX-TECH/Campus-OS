import { rerollAvatar } from '@campusos/module-identity/handles';
import { currentActor } from '@/lib/auth';

/** Re roll your own avatar. It carries no meaning, so there is no cooldown. */
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'not_signed_in' }, { status: 401 });
  return Response.json({ avatarSeed: await rerollAvatar(actor.userId) });
}
