import { isValidObjectKey } from '@campusos/core';
import { getObjectStore } from '@campusos/media';

/**
 * Serve a stored blob by its key.
 *
 * In production nginx serves `/media/*` straight from the data directory (UUID
 * keys, long-lived immutable cache) and requests never reach Next. This route is
 * the development equivalent, and a correct fallback if nginx is ever bypassed:
 * it reads through the same ObjectStore. Keys are unguessable UUIDs, so the URL
 * itself is the capability; there is no per-request tenant check here (nginx
 * could not do one either), matching the deliberate serving model.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join('/');
  if (!isValidObjectKey(key)) return new Response('Not found', { status: 404 });

  const object = await getObjectStore().get(key);
  if (!object) return new Response('Not found', { status: 404 });

  // Copy into an ArrayBuffer-backed view so BodyInit's typing is satisfied
  // regardless of the store's Buffer backing.
  return new Response(new Blob([new Uint8Array(object.bytes)], { type: object.contentType }), {
    headers: { 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
