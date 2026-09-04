import { z } from 'zod';
import { deleteComment, editComment } from '@campusos/module-communities/comments';
import { reportItem } from '@campusos/module-communities/moderation';
import { saveItem } from '@campusos/module-communities/saved';
import { voteComment } from '@campusos/module-communities/votes';
import { communityGate, refusalResponse } from '@/lib/community-route';

/** What a person does to one comment: vote, save, report, and for the author, edit and delete. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const tenant = z.string().min(1).max(64);
const schema = z.discriminatedUnion('action', [
  z.object({
    tenant,
    action: z.literal('vote'),
    value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  }),
  z.object({ tenant, action: z.literal('save'), on: z.boolean() }),
  z.object({
    tenant,
    action: z.literal('report'),
    reason: z.string(),
    note: z.string().optional(),
  }),
  z.object({ tenant, action: z.literal('edit'), body: z.string() }),
  z.object({ tenant, action: z.literal('delete') }),
]);

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const gate = await communityGate(request, 'comment-action', 120, schema);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const actor = { userId: gate.actor.userId };
  const slug = gate.tenant.slug;
  const data = gate.data;
  switch (data.action) {
    case 'vote': {
      const result = await voteComment(actor, slug, id, data.value);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'save': {
      const result = await saveItem(actor, slug, 'comment', id, data.on);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'report': {
      const result = await reportItem(actor, slug, {
        itemType: 'comment',
        itemId: id,
        reason: data.reason as Parameters<typeof reportItem>[2]['reason'],
        note: data.note,
      });
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'edit': {
      const result = await editComment(actor, slug, id, data.body);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
    case 'delete': {
      const result = await deleteComment(actor, slug, id);
      return result.ok ? Response.json(result.value) : refusalResponse(result.error);
    }
  }
}
