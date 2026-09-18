import type { Sql } from 'postgres';
import { DEMO_SLUG, seedDemo } from './seed';

/**
 * Reset the `demo` tenant to its seeded, known state: wipe its content, then re-seed.
 * Owner-run and idempotent. Only ever touches `demo` (every delete is scoped to
 * tenant_id = 'demo'); the seeded persona accounts are kept (re-seeding is idempotent
 * on them), so no platform-level `users` rows are deleted. See
 * docs/runbooks/demo-tenant.md.
 */

// Content tables in child-before-parent order, so the deletes never trip a foreign
// key. Every one carries tenant_id; the wipe is scoped to 'demo'.
const CONTENT_TABLES: readonly string[] = [
  // rides
  'ride_ratings',
  'ride_seat_requests',
  'ride_posts',
  // messages
  'msg_messages',
  'msg_participant_state',
  'msg_conversations',
  // marketplace
  'mkt_reviews',
  'mkt_order_events',
  'mkt_orders',
  'mkt_gig_packages',
  'mkt_gigs',
  'mkt_listings',
  // lost & found
  'lf_item_photos',
  'lf_items',
  // communities
  'comment_votes',
  'post_votes',
  'poll_votes',
  'poll_options',
  'comments',
  'posts',
  'community_karma',
  'communities',
  // timetable
  'timetable_entries',
  'sections',
  'courses',
  'teachers',
  'programs',
  'departments',
  'academic_terms',
  'rooms',
  'buildings',
  'campuses',
];

/** Delete every demo content row (child-before-parent), scoped to the demo tenant. */
export async function wipeDemo(sql: Sql): Promise<void> {
  // FORCE content tables filter deletes by app.tenant_id; setting it also makes the
  // scope explicit for the NO FORCE ones. Owner-run.
  await sql`select set_config('app.tenant_id', ${DEMO_SLUG}, false)`;
  for (const table of CONTENT_TABLES) {
    // `table` is a fixed allowlist constant, never user input; the value is bound.
    await sql.unsafe(`delete from ${table} where tenant_id = $1`, [DEMO_SLUG]);
  }
  await sql`select set_config('app.tenant_id', '', false)`;
}

/** Wipe the demo tenant's content and re-seed it to a known state. */
export async function resetDemo(sql: Sql): Promise<void> {
  await wipeDemo(sql);
  await seedDemo(sql);
}
