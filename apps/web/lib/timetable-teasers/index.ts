import { communityBySlug } from '@campusos/module-communities/communities';
import { listCommunityPosts } from '@campusos/module-communities/feed';
import { listItems } from '@campusos/module-lost-found/items';
import { listListings } from '@campusos/module-marketplace/listings';
import { getTenantRegistry } from '@/lib/tenants';
import { tenantBase } from '@/lib/tenant-url';
import { buildTeaserTiles, type TeaserInput, type TeaserTile } from './tiles';

/**
 * "What's on at LGU right now" teasers under the timetable, shown to ANY viewer
 * (signed-in or not) because ~all timetable traffic is anonymous. Each tile is real data
 * with a link to a page that is already public to browse; posting/commenting there is what
 * prompts sign-in. A tile with no data is dropped; if all three are empty the caller hides
 * the strip. No writes, no per-viewer state, so it renders server-side for anonymous
 * visitors and needs no session.
 *
 * "Confessions" is not a first-class concept, so it resolves to the community with the slug
 * TEASER_CONFESSIONS_SLUG (default "confessions"); if that community does not exist or has
 * no post, the tile is simply dropped. The pure tile shaping lives in ./tiles.
 */

export type { TeaserTile } from './tiles';
export { buildTeaserTiles } from './tiles';

const CONFESSIONS_SLUG = process.env.TEASER_CONFESSIONS_SLUG ?? 'confessions';
const UNDER_PAISA = 500_000; // Rs 5000

/** Fetch the three picks for a tenant and shape them into the strip's tiles. */
export async function getTimetableTeasers(slug: string): Promise<TeaserTile[]> {
  const base = await tenantBase(slug);
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return [];

  const wantConfession = tenant.enabledModules.includes('communities');
  const wantLostFound = tenant.enabledModules.includes('lost-found');
  const wantMarketplace = tenant.enabledModules.includes('marketplace');

  const [confessionPost, lostFoundItem, marketplaceListing] = await Promise.all([
    wantConfession ? latestConfession(slug) : Promise.resolve(null),
    wantLostFound ? newestItemWithPhoto(slug) : Promise.resolve(null),
    wantMarketplace ? newestAffordableListing(slug) : Promise.resolve(null),
  ]);

  return buildTeaserTiles({
    base,
    confession: confessionPost,
    lostFound: lostFoundItem,
    marketplace: marketplaceListing,
  });
}

async function latestConfession(slug: string): Promise<TeaserInput['confession']> {
  const community = await communityBySlug(slug, CONFESSIONS_SLUG);
  if (!community) return null;
  const { items } = await listCommunityPosts(null, slug, community.id, { sort: 'new', limit: 1 });
  const post = items[0];
  if (!post) return null;
  return { title: post.title, body: post.body, communitySlug: post.community.slug, id: post.id };
}

async function newestItemWithPhoto(slug: string): Promise<TeaserInput['lostFound']> {
  const { items } = await listItems(slug, {});
  const withPhoto = items.find((i) => i.thumbKey);
  if (!withPhoto) return null;
  return { title: withPhoto.title, thumbKey: withPhoto.thumbKey, id: withPhoto.id };
}

async function newestAffordableListing(slug: string): Promise<TeaserInput['marketplace']> {
  const { items } = await listListings(slug, {
    filters: { priceMaxPaisa: UNDER_PAISA },
    sort: 'new',
    status: 'active',
  });
  const listing = items[0];
  if (!listing) return null;
  return {
    title: listing.title,
    pricePaisa: listing.pricePaisa,
    priceKind: listing.priceKind,
    thumbKey: listing.thumbKey,
    id: listing.id,
  };
}
