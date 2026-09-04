import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';

/**
 * The communities tables. Every one carries `tenant_id` and is under RLS with
 * the ordinary tenant policy; three of them (memberships, member roles, bans)
 * are read by a definer function and so have RLS without FORCE.
 *
 * References to people and to roles are plain uuids here: the foreign keys
 * exist in SQL (drizzle/0000), but this module never imports another module's
 * schema, and drizzle does not need the reference to query.
 *
 * `posts.author_id` and `comments.author_id` are not readable by the
 * application role at all (see the migration). Reads go through `posts_read`
 * and `comments_read`, which expose `is_own` and a masked
 * `public_author_id`; every select in this module targets those views.
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true });

export const communities = pgTable(
  'communities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    iconSeed: text('icon_seed').notNull(),
    bannerSeed: text('banner_seed').notNull(),
    /** public | restricted */
    visibility: text('visibility').notNull().default('public'),
    allowAnonymous: boolean('allow_anonymous').notNull().default(true),
    /** text | link | poll */
    allowedKinds: text('allowed_kinds')
      .array()
      .notNull()
      .default(sql`'{text,link}'::text[]`),
    /** approved | pending */
    approvalStatus: text('approval_status').notNull().default('approved'),
    modLogPublic: boolean('mod_log_public').notNull().default(false),
    memberCount: integer('member_count').notNull().default(0),
    archivedAt: tz('archived_at'),
    createdBy: uuid('created_by').notNull(),
    createdAt,
    deletedAt: tz('deleted_at'),
  },
  (t) => [uniqueIndex('communities_tenant_slug_uq').on(t.tenantId, t.slug)],
);

export const communityRules = pgTable(
  'community_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
  },
  (t) => [index('community_rules_community_idx').on(t.communityId, t.position)],
);

export const communityMemberships = pgTable(
  'community_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    joinedAt: tz('joined_at').notNull().defaultNow(),
    leftAt: tz('left_at'),
  },
  (t) => [
    uniqueIndex('community_memberships_community_user_uq').on(t.communityId, t.userId),
    index('community_memberships_user_idx').on(t.tenantId, t.userId),
  ],
);

export const communityMemberRoles = pgTable(
  'community_member_roles',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => communityMemberships.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id').notNull(),
    userId: uuid('user_id').notNull(),
    grantedAt: tz('granted_at').notNull().defaultNow(),
    grantedBy: uuid('granted_by'),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.roleId] }),
    index('community_member_roles_user_idx').on(t.tenantId, t.userId, t.communityId),
  ],
);

export const communityBans = pgTable(
  'community_bans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Null means the whole tenant. */
    communityId: uuid('community_id').references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    reason: text('reason').notNull(),
    /** Null means permanent. */
    until: tz('until'),
    createdBy: uuid('created_by').notNull(),
    createdAt,
    liftedAt: tz('lifted_at'),
  },
  (t) => [index('community_bans_user_idx').on(t.tenantId, t.userId, t.communityId)],
);

export const communityMutes = pgTable(
  'community_mutes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    reason: text('reason').notNull(),
    until: tz('until'),
    createdBy: uuid('created_by').notNull(),
    createdAt,
    liftedAt: tz('lifted_at'),
  },
  (t) => [index('community_mutes_user_idx').on(t.tenantId, t.userId, t.communityId)],
);

export const userBlocks = pgTable(
  'user_blocks',
  {
    tenantId: text('tenant_id').notNull(),
    blockerId: uuid('blocker_id').notNull(),
    blockedId: uuid('blocked_id').notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.blockerId, t.blockedId] })],
);

export const postFlairs = pgTable(
  'post_flairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#6b7280'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('post_flairs_community_idx').on(t.communityId, t.position)],
);

export const userFlairs = pgTable(
  'user_flairs',
  {
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    text: text('text').notNull(),
    color: text('color').notNull().default('#6b7280'),
  },
  (t) => [primaryKey({ columns: [t.communityId, t.userId] })],
);

/**
 * Posts. `author_id` is written by the application and never read by it; the
 * generated `public_author_id` is the author for non-anonymous posts and null
 * otherwise, and is what profiles and indexes use.
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull(),
    publicAuthorId: uuid('public_author_id').generatedAlwaysAs(
      sql`case when is_anonymous then null else author_id end`,
    ),
    /** text | link | poll */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    url: text('url'),
    urlDomain: text('url_domain'),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    spoiler: boolean('spoiler').notNull().default(false),
    flairId: uuid('flair_id').references(() => postFlairs.id, { onDelete: 'set null' }),
    pinnedAt: tz('pinned_at'),
    pinnedBy: uuid('pinned_by'),
    lockedAt: tz('locked_at'),
    lockedBy: uuid('locked_by'),
    removedAt: tz('removed_at'),
    removedBy: uuid('removed_by'),
    removalReason: text('removal_reason'),
    deletedAt: tz('deleted_at'),
    editedAt: tz('edited_at'),
    upVotes: integer('up_votes').notNull().default(0),
    downVotes: integer('down_votes').notNull().default(0),
    score: integer('score').notNull().default(0),
    hotScore: numeric('hot_score', { precision: 20, scale: 7 }).notNull().default('0'),
    controversy: numeric('controversy', { precision: 20, scale: 7 }).notNull().default('0'),
    commentCount: integer('comment_count').notNull().default(0),
    createdAt,
  },
  (t) => [
    index('posts_feed_hot_idx').on(t.tenantId, t.communityId, t.hotScore, t.id),
    index('posts_feed_new_idx').on(t.tenantId, t.communityId, t.createdAt, t.id),
    index('posts_feed_top_idx').on(t.tenantId, t.communityId, t.score, t.createdAt, t.id),
    index('posts_all_hot_idx').on(t.tenantId, t.hotScore, t.id),
    index('posts_all_new_idx').on(t.tenantId, t.createdAt, t.id),
    index('posts_profile_idx').on(t.tenantId, t.publicAuthorId, t.createdAt),
    index('posts_url_idx').on(t.tenantId, t.communityId, t.url),
  ],
);

export const postEdits = pgTable('post_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  postId: uuid('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  editedAt: tz('edited_at').notNull().defaultNow(),
  previousTitle: text('previous_title').notNull(),
  previousBody: text('previous_body'),
});

export const postVotes = pgTable(
  'post_votes',
  {
    tenantId: text('tenant_id').notNull(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    value: integer('value').notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    path: text('path').notNull(),
    depth: integer('depth').notNull().default(0),
    authorId: uuid('author_id').notNull(),
    publicAuthorId: uuid('public_author_id').generatedAlwaysAs(
      sql`case when is_anonymous then null else author_id end`,
    ),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    body: text('body').notNull(),
    removedAt: tz('removed_at'),
    removedBy: uuid('removed_by'),
    removalReason: text('removal_reason'),
    deletedAt: tz('deleted_at'),
    editedAt: tz('edited_at'),
    upVotes: integer('up_votes').notNull().default(0),
    downVotes: integer('down_votes').notNull().default(0),
    score: integer('score').notNull().default(0),
    bestScore: numeric('best_score', { precision: 12, scale: 7 }).notNull().default('0'),
    controversy: numeric('controversy', { precision: 20, scale: 7 }).notNull().default('0'),
    createdAt,
  },
  (t) => [
    index('comments_post_path_idx').on(t.postId, t.path),
    index('comments_profile_idx').on(t.tenantId, t.publicAuthorId, t.createdAt),
  ],
);

export const commentEdits = pgTable('comment_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  commentId: uuid('comment_id')
    .notNull()
    .references(() => comments.id, { onDelete: 'cascade' }),
  editedAt: tz('edited_at').notNull().defaultNow(),
  previousBody: text('previous_body').notNull(),
});

export const commentVotes = pgTable(
  'comment_votes',
  {
    tenantId: text('tenant_id').notNull(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    value: integer('value').notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

export const savedItems = pgTable(
  'saved_items',
  {
    tenantId: text('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** post | comment */
    itemType: text('item_type').notNull(),
    itemId: uuid('item_id').notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemType, t.itemId] })],
);

export const hiddenItems = pgTable(
  'hidden_items',
  {
    tenantId: text('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    itemType: text('item_type').notNull(),
    itemId: uuid('item_id').notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemType, t.itemId] })],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(),
    itemId: uuid('item_id').notNull(),
    reporterId: uuid('reporter_id').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    /** open | resolved */
    status: text('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: tz('resolved_at'),
    /** approved | removed | dismissed */
    resolution: text('resolution'),
    createdAt,
  },
  (t) => [
    uniqueIndex('reports_item_reporter_uq').on(t.itemType, t.itemId, t.reporterId),
    index('reports_queue_idx').on(t.tenantId, t.communityId, t.status, t.createdAt),
  ],
);

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason'),
    meta: jsonb('meta'),
    createdAt,
  },
  (t) => [index('moderation_actions_community_idx').on(t.communityId, t.createdAt)],
);

export const automodRules = pgTable(
  'automod_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    /** keyword | domain */
    kind: text('kind').notNull(),
    pattern: text('pattern').notNull(),
    /** queue | remove */
    action: text('action').notNull().default('queue'),
    createdBy: uuid('created_by').notNull(),
    createdAt,
  },
  (t) => [index('automod_rules_community_idx').on(t.communityId)],
);

/**
 * The read views. Owned by the schema owner, so RLS on the tables applies to
 * the owner (FORCE) with the caller's transaction context, and the application
 * role, which cannot select `author_id`, reads these instead. `is_own` is the
 * one thing the view knows that the caller may not.
 */
export const postsRead = pgView('posts_read', {
  id: uuid('id').notNull(),
  tenantId: text('tenant_id').notNull(),
  communityId: uuid('community_id').notNull(),
  publicAuthorId: uuid('public_author_id'),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  url: text('url'),
  urlDomain: text('url_domain'),
  isAnonymous: boolean('is_anonymous').notNull(),
  spoiler: boolean('spoiler').notNull(),
  flairId: uuid('flair_id'),
  pinnedAt: tz('pinned_at'),
  lockedAt: tz('locked_at'),
  removedAt: tz('removed_at'),
  removalReason: text('removal_reason'),
  deletedAt: tz('deleted_at'),
  editedAt: tz('edited_at'),
  upVotes: integer('up_votes').notNull(),
  downVotes: integer('down_votes').notNull(),
  score: integer('score').notNull(),
  hotScore: numeric('hot_score', { precision: 20, scale: 7 }).notNull(),
  controversy: numeric('controversy', { precision: 20, scale: 7 }).notNull(),
  commentCount: integer('comment_count').notNull(),
  createdAt: tz('created_at').notNull(),
  isOwn: boolean('is_own').notNull(),
}).existing();

export const commentsRead = pgView('comments_read', {
  id: uuid('id').notNull(),
  tenantId: text('tenant_id').notNull(),
  postId: uuid('post_id').notNull(),
  parentId: uuid('parent_id'),
  path: text('path').notNull(),
  depth: integer('depth').notNull(),
  publicAuthorId: uuid('public_author_id'),
  isAnonymous: boolean('is_anonymous').notNull(),
  body: text('body').notNull(),
  removedAt: tz('removed_at'),
  removalReason: text('removal_reason'),
  deletedAt: tz('deleted_at'),
  editedAt: tz('edited_at'),
  upVotes: integer('up_votes').notNull(),
  downVotes: integer('down_votes').notNull(),
  score: integer('score').notNull(),
  bestScore: numeric('best_score', { precision: 12, scale: 7 }).notNull(),
  controversy: numeric('controversy', { precision: 20, scale: 7 }).notNull(),
  createdAt: tz('created_at').notNull(),
  isOwn: boolean('is_own').notNull(),
}).existing();

/**
 * The identity module's public profile view (handle and avatar seed of an
 * active account), declared here as existing so posts and comments can join
 * their public author to it without importing another module.
 */
export const publicProfiles = pgView('public_profiles', {
  userId: uuid('user_id').notNull(),
  handle: text('handle').notNull(),
  avatarSeed: text('avatar_seed').notNull(),
}).existing();
