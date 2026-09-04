import { z } from 'zod';
import {
  approveItem,
  liftSanction,
  movePin,
  muteMember,
  removeItem,
  setLocked,
  setPinned,
} from '@campusos/module-communities/mod-actions';
import { banMember, unmaskAuthor } from '@campusos/module-communities/moderation';
import { setArchived } from '@campusos/module-communities/archive';
import { dissolveCommunity, handleOf } from '@campusos/module-communities/oversight';
import { approveCommunity } from '@campusos/module-communities/settings';
import { communityGate, refusalResponse } from '@/lib/community-route';

/**
 * What a moderator does in one community, and what the tenant does over it.
 * The module checks the permission inside each transaction; this route only
 * shapes the request. The community id in the path scopes mutes, bans and
 * dissolution; content actions find their community from the item.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const tenant = z.string().min(1).max(64);
const uuid = z.string().uuid();
const itemType = z.enum(['post', 'comment']);
const minutes = z
  .number()
  .int()
  .min(1)
  .max(60 * 24 * 365)
  .optional();
const schema = z.discriminatedUnion('action', [
  z.object({ tenant, action: z.literal('remove'), itemType, itemId: uuid, reason: z.string() }),
  z.object({ tenant, action: z.literal('approve'), itemType, itemId: uuid }),
  z.object({ tenant, action: z.literal('lock'), postId: uuid, on: z.boolean() }),
  z.object({ tenant, action: z.literal('pin'), postId: uuid, on: z.boolean() }),
  z.object({ tenant, action: z.literal('mute'), userId: uuid, reason: z.string(), minutes }),
  z.object({ tenant, action: z.literal('ban'), userId: uuid, reason: z.string(), minutes }),
  z.object({ tenant, action: z.literal('lift'), kind: z.enum(['ban', 'mute']), id: uuid }),
  z.object({
    tenant,
    action: z.literal('pinMove'),
    postId: uuid,
    direction: z.enum(['up', 'down']),
  }),
  z.object({ tenant, action: z.literal('dissolve'), reason: z.string() }),
  z.object({ tenant, action: z.literal('approveCommunity') }),
  z.object({ tenant, action: z.literal('archive'), on: z.boolean() }),
  z.object({ tenant, action: z.literal('unmask'), itemType, itemId: uuid, reportId: uuid }),
]);

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'mod', 60, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!uuid.safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const actor = { userId: gate.actor.userId };
  const slug = gate.tenant.slug;
  const data = gate.data;
  const reply = <T>(
    result: { ok: true; value: T } | { ok: false; error: Parameters<typeof refusalResponse>[0] },
  ) => (result.ok ? Response.json(result.value) : refusalResponse(result.error));
  switch (data.action) {
    case 'remove':
      return reply(
        await removeItem(actor, slug, data.itemType, data.itemId, { reason: data.reason }),
      );
    case 'approve':
      return reply(await approveItem(actor, slug, data.itemType, data.itemId));
    case 'lock':
      return reply(await setLocked(actor, slug, data.postId, data.on));
    case 'pin':
      return reply(await setPinned(actor, slug, data.postId, data.on, gate.settings));
    case 'mute':
      return reply(
        await muteMember(actor, slug, id, data.userId, {
          reason: data.reason,
          minutes: data.minutes,
        }),
      );
    case 'ban':
      return reply(
        await banMember(actor, slug, id, data.userId, {
          reason: data.reason,
          minutes: data.minutes,
        }),
      );
    case 'pinMove':
      return reply(await movePin(actor, slug, data.postId, data.direction));
    case 'lift':
      return reply(await liftSanction(actor, slug, data.kind, data.id));
    case 'archive':
      return reply(await setArchived(actor, slug, id, data.on));
    case 'approveCommunity':
      return reply(await approveCommunity(actor, slug, id));
    case 'dissolve':
      return reply(await dissolveCommunity(actor, slug, id, { reason: data.reason }));
    case 'unmask': {
      const result = await unmaskAuthor(actor, slug, data.itemType, data.itemId, data.reportId);
      if (!result.ok) return refusalResponse(result.error);
      return Response.json({ handle: await handleOf(actor, slug, result.value.userId) });
    }
  }
}
