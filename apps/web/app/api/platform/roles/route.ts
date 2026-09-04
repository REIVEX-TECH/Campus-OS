import { z } from 'zod';
import {
  createRoleTemplate,
  deleteRoleTemplate,
  setRoleTemplatePermissions,
} from '@campusos/module-identity/role-templates';
import { platformAdmin } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { readJson } from '@/lib/read-json';
import { isSameOrigin } from '@/lib/same-origin';

/**
 * Role definitions: create one, change what it carries, retire it.
 *
 * Platform administrators only, and 404 to anyone else so the surface never
 * confirms its own existence. There is no tenant here, on purpose: a definition
 * is not a tenant's to own, and this route needs no tenant context to write one.
 */
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    name: z.string(),
    permissions: z.array(z.string()).max(64),
  }),
  z.object({
    action: z.literal('permissions'),
    key: z.string().min(1).max(64),
    permissions: z.array(z.string()).max(64),
  }),
  z.object({ action: z.literal('delete'), key: z.string().min(1).max(64) }),
]);

const STATUS: Record<string, number> = {
  not_allowed: 404,
  bad_name: 400,
  exists: 409,
  no_such_template: 404,
  system_template: 409,
};

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request.headers)) {
    return Response.json({ error: 'origin' }, { status: 403 });
  }
  if (!rateLimit(`platform-roles:${clientKey(request.headers)}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await platformAdmin();
  if (!admin) return Response.json({ error: 'not_found' }, { status: 404 });
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  const data = parsed.data;
  const actor = { userId: admin.actor.userId };

  const result =
    data.action === 'create'
      ? await createRoleTemplate(actor, { name: data.name, permissions: data.permissions })
      : data.action === 'permissions'
        ? await setRoleTemplatePermissions(actor, data.key, data.permissions)
        : await deleteRoleTemplate(actor, data.key);
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: STATUS[result.reason] ?? 400 });
  }
  return Response.json(result);
}
