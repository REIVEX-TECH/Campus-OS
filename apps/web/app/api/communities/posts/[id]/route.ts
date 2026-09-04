import { z } from 'zod';
import { reportItem } from '@campusos/module-communities/moderation';
import { deletePost, editPost } from '@campusos/module-communities/posts';
import { hideItem, saveItem } from '@campusos/module-communities/saved';
import { crosspost } from '@campusos/module-communities/crosspost';
import { votePoll } from '@campusos/module-communities/polls';
import { votePost } from '@campusos/module-communities/votes';
import { communityGate, refusalResponse } from '@/lib/community-route';

/**
 * What a person does to one post: vote, save, hide, report, and for the
 * author, edit and delete. One route, one gate; the module re-checks each
 * action inside its own transaction and keeps its own limits (reports, votes).
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion('action', [
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('vote'),
    value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  }),
  z.object({ tenant: z.string().min(1).max(64), action: z.literal('save'), on: z.boolean() }),
  z.object({ tenant: z.string().min(1).max(64), action: z.literal('hide'), on: z.boolean() }),
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('report'),
    reason: z.string(),
    note: z.string().optional(),
  }),
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('edit'),
    title: z.string(),
    body: z.string().optional(),
  }),
  z.object({ tenant: z.string().min(1).max(64), action: z.literal('delete') }),
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('pollVote'),
    optionId: z.string().uuid(),
  }),
  z.object({
    tenant: z.string().min(1).max(64),
    action: z.literal('crosspost'),
    communityId: z.string().uuid(),
  }),
]);

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'post-action', 120, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const actor = { userId: gate.actor.userId };
  const tenant = gate.tenant.slug;
  const data = gate.data;

  switch (data.action) {
    case 'vote': {
      const result = await votePost(actor, tenant, id, data.value);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'save': {
      const result = await saveItem(actor, tenant, 'post', id, data.on);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'hide': {
      const result = await hideItem(actor, tenant, 'post', id, data.on);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'report': {
      const result = await reportItem(
        actor,
        tenant,
        {
          itemType: 'post',
          itemId: id,
          // Validated by the module against its own reason list.
          reason: data.reason as Parameters<typeof reportItem>[2]['reason'],
          note: data.note,
        },
        gate.settings,
      );
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'edit': {
      const result = await editPost(actor, tenant, id, { title: data.title, body: data.body });
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'crosspost': {
      const result = await crosspost(actor, tenant, id, data.communityId, gate.settings);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'pollVote': {
      const result = await votePoll(actor, tenant, id, data.optionId);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'delete': {
      const result = await deletePost(actor, tenant, id);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
  }
}
