import { z } from 'zod';
import { getObjectStore, newImageKeys } from '@campusos/media';
import { processImage, sniffImageType, MediaError } from '@campusos/media/image';
import { addItemPhoto } from '@campusos/module-lost-found/write';
import { currentActor } from '@/lib/auth';
import { lostFoundEnabled, lostFoundSettings } from '@/lib/lost-found';
import { refusalResponse } from '@/lib/lost-found-route';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/same-origin';
import { getTenantRegistry } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

/**
 * Upload one photo for an item. Server-mediated on purpose: the bytes are
 * size-capped and magic-byte sniffed BEFORE sharp, then re-encoded to WebP
 * (which strips EXIF/GPS) into a display image and a thumbnail, stored under
 * unguessable keys, and recorded only if the item is the caller's. A per-user
 * rate limit sits in front. Verification and ownership are enforced by the
 * module and the RESTRICTIVE insert policy.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (!isSameOrigin(request.headers)) {
    return Response.json({ error: 'origin' }, { status: 403 });
  }
  const actor = await currentActor();
  if (!actor) return Response.json({ error: 'unauthorised' }, { status: 401 });
  // Per-user upload rate limit, before any work.
  if (!rateLimit(`lostfound-upload:${actor.userId}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  // Also cap by client, so one account cannot be driven from many IPs unbounded.
  if (!rateLimit(`lostfound-upload-ip:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const form = await request.formData().catch(() => null);
  const slug = form?.get('tenant');
  const file = form?.get('file');
  if (typeof slug !== 'string' || !(file instanceof Blob)) {
    return Response.json({ error: 'invalid' }, { status: 400 });
  }
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant || !lostFoundEnabled(tenant)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const settings = lostFoundSettings(tenant);

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Magic-byte and size check BEFORE sharp.
  if (bytes.byteLength > settings.maxUploadBytes) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }
  if (sniffImageType(bytes) === null) {
    return Response.json({ error: 'unsupported_type' }, { status: 415 });
  }

  let processed;
  try {
    processed = await processImage(bytes, { maxBytes: settings.maxUploadBytes });
  } catch (error) {
    const code = error instanceof MediaError ? error.code : 'decode_failed';
    return Response.json({ error: code }, { status: 400 });
  }

  const store = getObjectStore();
  const keys = newImageKeys('lost-found');
  await store.put(keys.full, processed.full.bytes, { contentType: 'image/webp' });
  await store.put(keys.thumb, processed.thumb.bytes, { contentType: 'image/webp' });

  const recorded = await addItemPhoto(
    actor,
    tenant.slug,
    id,
    {
      storageKey: keys.full,
      thumbKey: keys.thumb,
      contentType: 'image/webp',
      width: processed.full.width,
      height: processed.full.height,
      byteSize: processed.full.bytes.byteLength,
    },
    settings.maxPhotosPerItem,
  );
  if (!recorded.ok) {
    // The item was not the caller's, or is full: do not leave orphan objects.
    await store.delete(keys.full);
    await store.delete(keys.thumb);
    return refusalResponse(recorded.error);
  }
  return Response.json({ ok: true, position: recorded.value.position });
}
