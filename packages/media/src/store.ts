import { randomUUID } from 'node:crypto';
import type { ObjectStore } from '@campusos/core';
import { LocalFsStore } from './fs-store';

let cached: ObjectStore | null = null;

/**
 * The process-wide object store, built from the environment.
 *
 * `MEDIA_DATA_DIR` is the directory blobs live in — outside the repo, on a
 * volume nginx serves in production (see docs/runbooks/media-storage.md). There
 * is one implementation today (local filesystem); an S3-compatible store would
 * be selected here behind the same `ObjectStore` interface.
 */
export function getObjectStore(): ObjectStore {
  if (cached) return cached;
  const dir = process.env.MEDIA_DATA_DIR;
  if (!dir || dir.trim() === '') {
    throw new Error('MEDIA_DATA_DIR is not set: object storage has no data directory');
  }
  cached = new LocalFsStore(dir);
  return cached;
}

/** Reset the cached store. Tests only. */
export function resetObjectStore(): void {
  cached = null;
}

/**
 * A fresh pair of keys for one photo — a display variant and its thumbnail —
 * sharing an unguessable UUID and fanned out one level to keep directories
 * small. Both are WebP. Callers store both keys.
 */
export function newImageKeys(prefix: string): { full: string; thumb: string } {
  const id = randomUUID();
  const shard = id.slice(0, 2);
  return {
    full: `${prefix}/${shard}/${id}.webp`,
    thumb: `${prefix}/${shard}/${id}_thumb.webp`,
  };
}
