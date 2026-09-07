import { searchProfiles } from '@campusos/module-communities/profiles';
import { messagesReadGate } from '@/lib/messages-route';

export const dynamic = 'force-dynamic';

/** Members whose handle starts with `q`, for the compose sheet's recipient picker. */
export async function GET(request: Request): Promise<Response> {
  const gate = await messagesReadGate(request);
  if (!gate.ok) return gate.response;
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const matches = await searchProfiles(gate.actor, gate.tenant.slug, q, 8);
  return Response.json({ matches });
}
