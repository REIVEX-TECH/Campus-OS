import { describe, expect, it } from 'vitest';
import { buildTeaserTiles, type TeaserInput } from '@/lib/timetable-teasers/tiles';

const BASE = '/u/lgu';

const input = (over: Partial<TeaserInput>): TeaserInput => ({
  base: BASE,
  confession: null,
  lostFound: null,
  marketplace: null,
  ...over,
});

describe('buildTeaserTiles', () => {
  it('drops every tile when there is no data (the caller then hides the strip)', () => {
    expect(buildTeaserTiles(input({}))).toEqual([]);
  });

  it('orders the tiles confession, lost-and-found, marketplace', () => {
    const tiles = buildTeaserTiles(
      input({
        confession: { title: 'Anon', body: 'hi', communitySlug: 'confessions', id: 'c1' },
        lostFound: { title: 'Blue bottle', thumbKey: 'ab/one.webp', id: 'l1' },
        marketplace: {
          title: 'Desk lamp',
          pricePaisa: 120000,
          priceKind: 'fixed',
          thumbKey: 'cd/two.webp',
          id: 'm1',
        },
      }),
    );
    expect(tiles.map((t) => t.kind)).toEqual(['confession', 'lostfound', 'marketplace']);
  });

  it('links each tile to its public destination', () => {
    const [confession, lostfound, marketplace] = buildTeaserTiles(
      input({
        confession: { title: 'A secret', body: null, communitySlug: 'confessions', id: 'c1' },
        lostFound: { title: 'Keys', thumbKey: 'ab/one.webp', id: 'l1' },
        marketplace: {
          title: 'Lamp',
          pricePaisa: 5000,
          priceKind: 'fixed',
          thumbKey: null,
          id: 'm1',
        },
      }),
    );
    expect(confession!.href).toContain('confessions');
    expect(confession!.href).toContain('c1');
    expect(lostfound!.href).toBe(`${BASE}/lost-found`);
    expect(marketplace!.href).toBe(`${BASE}/marketplace/m1`);
  });

  it('turns a lost-and-found thumb key into a media URL', () => {
    const [tile] = buildTeaserTiles(
      input({ lostFound: { title: 'Bag', thumbKey: 'ab/one.webp', id: 'l1' } }),
    );
    expect(tile).toMatchObject({ kind: 'lostfound', thumbUrl: '/media/ab/one.webp' });
  });

  it('drops the lost-and-found tile when the item has no photo (the thumbnail is the point)', () => {
    expect(
      buildTeaserTiles(input({ lostFound: { title: 'Wallet', thumbKey: null, id: 'l1' } })),
    ).toEqual([]);
  });

  it('keeps a marketplace tile with no photo, carrying a null thumb URL', () => {
    const [tile] = buildTeaserTiles(
      input({
        marketplace: {
          title: 'Notes',
          pricePaisa: 30000,
          priceKind: 'fixed',
          thumbKey: null,
          id: 'm1',
        },
      }),
    );
    expect(tile).toMatchObject({ kind: 'marketplace', thumbUrl: null, pricePaisa: 30000 });
  });

  it('keeps a free (Rs 0) marketplace tile so the strip can label it', () => {
    const [tile] = buildTeaserTiles(
      input({
        marketplace: {
          title: 'Free crate',
          pricePaisa: 0,
          priceKind: 'fixed',
          thumbKey: null,
          id: 'm1',
        },
      }),
    );
    expect(tile).toMatchObject({ kind: 'marketplace', pricePaisa: 0 });
  });

  it('trims a long confession body to a snippet and leaves a short one whole', () => {
    const [long] = buildTeaserTiles(
      input({
        confession: {
          title: 'Long',
          body: 'x'.repeat(200),
          communitySlug: 'confessions',
          id: 'c1',
        },
      }),
    );
    if (long?.kind !== 'confession') throw new Error('expected a confession tile');
    expect(long.snippet?.endsWith('...')).toBe(true);
    expect(long.snippet?.length ?? 0).toBeLessThanOrEqual(123);

    const [short] = buildTeaserTiles(
      input({
        confession: {
          title: 'Short',
          body: '  spaced   out  ',
          communitySlug: 'confessions',
          id: 'c2',
        },
      }),
    );
    if (short?.kind !== 'confession') throw new Error('expected a confession tile');
    expect(short.snippet).toBe('spaced out');
  });

  it('gives a bodyless confession a null snippet', () => {
    const [tile] = buildTeaserTiles(
      input({
        confession: { title: 'No body', body: null, communitySlug: 'confessions', id: 'c1' },
      }),
    );
    if (tile?.kind !== 'confession') throw new Error('expected a confession tile');
    expect(tile.snippet).toBeNull();
  });
});
