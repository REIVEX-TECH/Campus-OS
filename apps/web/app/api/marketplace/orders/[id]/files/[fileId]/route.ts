import { z } from 'zod';
import { getObjectStore } from '@campusos/media';
import { safeDownloadName } from '@campusos/media/file';
import { orderFileForDownload } from '@campusos/module-marketplace/orders-read';
import { currentActor } from '@/lib/auth';
import { marketplaceServicesEnabled } from '@/lib/marketplace';
import { getTenantRegistry } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

/**
 * Download one delivery file. Party-only: `orderFileForDownload` returns nothing
 * unless the caller is a party of the order (RLS). Always served as an attachment,
 * never inline, so a file can only be saved, not rendered in the origin.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(fileId).success) {
    return new Response('not found', { status: 404 });
  }
  const url = new URL(request.url);
  const slug = url.searchParams.get('tenant');
  if (!slug) return new Response('bad request', { status: 400 });
  const actor = await currentActor();
  if (!actor) return new Response('unauthorised', { status: 401 });
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant || !marketplaceServicesEnabled(tenant)) {
    return new Response('not found', { status: 404 });
  }

  const meta = await orderFileForDownload(actor, tenant.slug, id, fileId);
  if (!meta) return new Response('not found', { status: 404 });
  const object = await getObjectStore().get(meta.storageKey);
  if (!object) return new Response('not found', { status: 404 });

  const ext = meta.filename.includes('.') ? meta.filename.split('.').pop()! : 'bin';
  const download = safeDownloadName(meta.filename, ext);
  return new Response(object.bytes as BodyInit, {
    headers: {
      'content-type': meta.contentType,
      'content-disposition': `attachment; filename="${download}"`,
      'cache-control': 'private, no-store',
    },
  });
}
