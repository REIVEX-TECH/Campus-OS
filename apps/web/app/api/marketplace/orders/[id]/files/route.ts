import { z } from 'zod';
import { getObjectStore } from '@campusos/media';
import { FileError, newFileKey, validateUploadFile } from '@campusos/media/file';
import { addOrderDeliveryFile } from '@campusos/module-marketplace/orders-write';
import { currentActor } from '@/lib/auth';
import { marketplaceServicesEnabled } from '@/lib/marketplace';
import { refusalResponse } from '@/lib/marketplace-route';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { isSameOrigin } from '@/lib/same-origin';
import { getTenantRegistry } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

const MAX_DELIVERY_BYTES = 25 * 1024 * 1024;

/**
 * Upload one delivery file for an order. The seller attaches the finished work; the
 * bytes are size-capped and magic-byte checked against the non-image allowlist
 * (pdf/zip/docx/xlsx/pptx), stored under an unguessable key, and recorded only if
 * the order is the caller's to deliver (RLS). Served back as an attachment only.
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
  if (!rateLimit(`marketplace-delivery-upload:${actor.userId}`, 30, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!rateLimit(`marketplace-delivery-upload-ip:${clientKey(request.headers)}`, 60, 60_000)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const form = await request.formData().catch(() => null);
  const slug = form?.get('tenant');
  const file = form?.get('file');
  if (typeof slug !== 'string' || !(file instanceof Blob)) {
    return Response.json({ error: 'invalid' }, { status: 400 });
  }
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant || !marketplaceServicesEnabled(tenant)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = 'name' in file && typeof file.name === 'string' ? file.name : 'file';
  let validated;
  try {
    validated = validateUploadFile(bytes, {
      declaredType: file.type,
      filename,
      maxBytes: MAX_DELIVERY_BYTES,
    });
  } catch (error) {
    const code = error instanceof FileError ? error.code : 'invalid';
    const status = code === 'too_large' ? 413 : code === 'unsupported_type' ? 415 : 422;
    return Response.json({ error: code }, { status });
  }

  const store = getObjectStore();
  const key = newFileKey('marketplace/deliveries', validated.type.ext);
  await store.put(key, bytes, { contentType: validated.type.contentType });
  const recorded = await addOrderDeliveryFile(actor, tenant.slug, id, {
    storageKey: key,
    filename: filename.slice(0, 200),
    contentType: validated.type.contentType,
    byteSize: validated.byteSize,
  });
  if (!recorded.ok) {
    await store.delete(key).catch(() => undefined);
    return refusalResponse(recorded.error);
  }
  return Response.json({ ok: true, id: recorded.value.id });
}
