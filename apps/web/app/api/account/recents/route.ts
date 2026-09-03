import { z } from 'zod';
import { tenantRegistry } from '@campusos/tenants';
import {
  RECENT_KINDS,
  clearRecents,
  listRecents,
  recordRecent,
} from '@campusos/module-identity/recents';
import { currentActor } from '@/lib/auth';

/**
 * A signed in person's recently viewed timetables, per tenant.
 *
 * The tenant comes from the body or query rather than a header, because
 * middleware does not run on /api. That is safe here: the rows are the caller's
 * own under RLS whichever tenant they name, and a slug that is not a real tenant
 * is refused. The href is kept relative so nothing stored can ever point away
 * from this site.
 */

export const dynamic = 'force-dynamic';

const slug = z.string().min(1).max(64);

const recordSchema = z.object({
  tenant: slug,
  kind: z.enum(RECENT_KINDS),
  key: z.string().min(1).max(128),
  label: z.string().min(1).max(120),
  href: z
    .string()
    .min(1)
    .max(300)
    .regex(/^\/(?!\/)\S*$/, 'relative path'),
});

export async function POST(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });

  const parsed = recordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });
  const { tenant, ...item } = parsed.data;
  if (!tenantRegistry.resolveBySlug(tenant)) {
    return Response.json({ error: 'unknown_tenant' }, { status: 404 });
  }

  await recordRecent(actor.userId, tenant, item);
  return Response.json({ ok: true });
}

export async function GET(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });

  const tenant = slug.safeParse(new URL(request.url).searchParams.get('tenant'));
  if (!tenant.success || !tenantRegistry.resolveBySlug(tenant.data)) {
    return Response.json({ error: 'unknown_tenant' }, { status: 404 });
  }

  const items = await listRecents(actor.userId, tenant.data);
  return Response.json({
    items: items.map((i) => ({ ...i, viewedAt: i.viewedAt.getTime() })),
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });

  const tenant = slug.safeParse(new URL(request.url).searchParams.get('tenant'));
  if (!tenant.success || !tenantRegistry.resolveBySlug(tenant.data)) {
    return Response.json({ error: 'unknown_tenant' }, { status: 404 });
  }

  await clearRecents(actor.userId, tenant.data);
  return Response.json({ ok: true });
}
