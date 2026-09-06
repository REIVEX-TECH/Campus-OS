import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { isValidObjectKey, type ObjectStore, type StoredObject } from '@campusos/core';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * An {@link ObjectStore} over a local directory. Production serves the same
 * directory as static files through nginx (long-lived cache, UUID keys); the dev
 * route reads through this store. The store owns exactly `rootDir` and refuses
 * any key that would escape it — keys are validated by shape AND the resolved
 * path is re-checked to stay under the root.
 */
export class LocalFsStore implements ObjectStore {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathFor(key: string): string {
    if (!isValidObjectKey(key)) throw new Error('invalid object key');
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('object key escapes the store root');
    }
    return full;
  }

  async put(key: string, bytes: Uint8Array, _opts: { contentType: string }): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<StoredObject | null> {
    let path: string;
    try {
      path = this.pathFor(key);
    } catch {
      return null;
    }
    try {
      const bytes = await readFile(path);
      return { bytes, contentType: contentTypeFor(key) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  url(key: string): string {
    return `/media/${key}`;
  }

  /** Test/ops helper: the absolute path a key maps to, without touching disk. */
  resolvePath(key: string): string {
    return this.pathFor(key);
  }
}
