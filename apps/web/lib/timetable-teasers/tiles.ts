import { mediaUrl } from '@campusos/media';
import { postPath } from '@/lib/community-constants';

/**
 * The pure shaping of the timetable teaser strip: given the three raw picks, build the
 * visible tiles. No database, no module code, so it is unit-testable in isolation (the
 * fetch layer lives in ./index). A tile with no data is dropped; the lost-and-found tile
 * is dropped unless it has a photo, since a thumbnail is the whole point of that tile.
 * Order matches the strip: confession, lost and found, marketplace.
 */

const SNIPPET_MAX = 120;

export type TeaserTile =
  | { kind: 'confession'; title: string; snippet: string | null; href: string }
  | { kind: 'lostfound'; title: string; thumbUrl: string; href: string }
  | {
      kind: 'marketplace';
      title: string;
      pricePaisa: number;
      priceKind: string;
      thumbUrl: string | null;
      href: string;
    };

/** The raw picks (each already fetched, newest-first / filtered). Kept separate to test. */
export interface TeaserInput {
  base: string;
  confession: { title: string; body: string | null; communitySlug: string; id: string } | null;
  lostFound: { title: string; thumbKey: string | null; id: string } | null;
  marketplace: {
    title: string;
    pricePaisa: number;
    priceKind: string;
    thumbKey: string | null;
    id: string;
  } | null;
}

function snippetOf(body: string | null): string | null {
  if (!body) return null;
  const trimmed = body.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.length > SNIPPET_MAX ? `${trimmed.slice(0, SNIPPET_MAX).trimEnd()}...` : trimmed;
}

export function buildTeaserTiles(input: TeaserInput): TeaserTile[] {
  const tiles: TeaserTile[] = [];
  const { base } = input;

  if (input.confession) {
    tiles.push({
      kind: 'confession',
      title: input.confession.title,
      snippet: snippetOf(input.confession.body),
      href: postPath(
        base,
        input.confession.communitySlug,
        input.confession.id,
        input.confession.title,
      ),
    });
  }
  if (input.lostFound && input.lostFound.thumbKey) {
    tiles.push({
      kind: 'lostfound',
      title: input.lostFound.title,
      thumbUrl: mediaUrl(input.lostFound.thumbKey),
      href: `${base}/lost-found`,
    });
  }
  if (input.marketplace) {
    tiles.push({
      kind: 'marketplace',
      title: input.marketplace.title,
      pricePaisa: input.marketplace.pricePaisa,
      priceKind: input.marketplace.priceKind,
      thumbUrl: input.marketplace.thumbKey ? mediaUrl(input.marketplace.thumbKey) : null,
      href: `${base}/marketplace/${input.marketplace.id}`,
    });
  }
  return tiles;
}
