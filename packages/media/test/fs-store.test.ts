import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalFsStore } from '../src/fs-store';
import { newImageKeys } from '../src/store';

describe('LocalFsStore', () => {
  let dir: string;
  let store: LocalFsStore;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'campusos-media-'));
    store = new LocalFsStore(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips put / get / delete and fans out into subdirectories', async () => {
    const { full } = newImageKeys('lost-found');
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await store.put(full, bytes, { contentType: 'image/webp' });

    const got = await store.get(full);
    expect(got?.contentType).toBe('image/webp');
    expect(got ? [...got.bytes] : null).toEqual([1, 2, 3, 4, 5]);
    // Fanned out: the key has a shard directory, and it resolved under the root.
    expect(store.resolvePath(full).startsWith(dir)).toBe(true);

    await store.delete(full);
    expect(await store.get(full)).toBeNull();
  });

  it('returns null for a missing key rather than throwing', async () => {
    expect(await store.get('lost-found/aa/does-not-exist.webp')).toBeNull();
  });

  it('refuses a traversal key: get is null, put throws, none escape the root', async () => {
    expect(await store.get('../escape.webp')).toBeNull();
    await expect(
      store.put('../escape.webp', new Uint8Array([9]), { contentType: 'x' }),
    ).rejects.toThrow();
    expect(() => store.resolvePath('a/../../b')).toThrow();
  });

  it('builds a relative /media/ URL from a key', () => {
    const { full, thumb } = newImageKeys('lost-found');
    expect(store.url(full)).toBe(`/media/${full}`);
    expect(thumb.endsWith('_thumb.webp')).toBe(true);
    expect(full.startsWith('lost-found/')).toBe(true);
  });
});
