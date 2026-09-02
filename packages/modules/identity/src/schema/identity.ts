import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { universities } from '@campusos/db/schema';

/**
 * The identity tables.
 *
 * Most are PLATFORM level, not tenant scoped: a person exists above any one
 * university and may belong to several. That is why they cannot rely on the
 * `app.tenant_id` policy the rest of the schema uses, and why a second context
 * (`app.user_id`) exists. `tenant_memberships` is the join between the two
 * worlds and is the only table here carrying a `tenant_id`.
 *
 * Google gives us a subject id and a verified email and nothing else is kept:
 * no display name, no photo. The public identity is the anonymous handle.
 */

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Google's stable subject id. Stable across email changes, unlike the email. */
    googleSub: text('google_sub').notNull(),
    /** Verified by the provider before we ever see it. */
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }).notNull(),
    /** The public, anonymous identity. Never the email. */
    handle: text('handle').notNull(),
    handleChangedAt: timestamp('handle_changed_at', { withTimezone: true }),
    /** Seeds the generated avatar; carries no meaning. */
    avatarSeed: text('avatar_seed').notNull(),
    status: text('status').notNull().default('active'),
    createdAt,
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_google_sub_uq').on(t.googleSub),
    // citext would be tidier, but a lowered index needs no extension and gives
    // the same guarantee: two handles cannot differ only by case, so a handle
    // cannot be taken to impersonate its owner.
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    uniqueIndex('users_handle_lower_uq').on(sql`lower(${t.handle})`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the opaque token, hex encoded. A dump yields no live session. */
    tokenHash: text('token_hash').notNull(),
    createdAt,
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    /** Hashed, never raw: no PII at rest (CLAUDE.md 8). */
    ipHash: text('ip_hash'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** student | teacher | tenant_admin */
    role: text('role').notNull(),
    /** active | invited | suspended */
    status: text('status').notNull().default('active'),
    createdAt,
  },
  (t) => [
    uniqueIndex('tenant_memberships_tenant_user_uq').on(t.tenantId, t.userId),
    index('tenant_memberships_user_idx').on(t.userId),
  ],
);

/**
 * Platform wide roles, deliberately a separate table rather than a value on
 * membership: `platform_admin` is not scoped to a tenant and must never be
 * grantable by a tenant admin.
 */
export const platformRoles = pgTable('platform_roles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Handles a user has released. Reserved for a window after the change so a freed
 * handle cannot immediately be taken to impersonate its former owner.
 */
export const handleHistory = pgTable(
  'handle_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    handle: text('handle').notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
    reservedUntil: timestamp('reserved_until', { withTimezone: true }).notNull(),
  },
  (t) => [index('handle_history_handle_idx').on(sql`lower(${t.handle})`)],
);

/**
 * Append only. Update and delete are revoked and additionally blocked by a
 * trigger, so a compromised application cannot rewrite history.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Set when the action was taken under a platform admin tenant grant. */
    adminTenantSessionId: uuid('admin_tenant_session_id'),
    tenantId: text('tenant_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    meta: jsonb('meta'),
  },
  (t) => [
    index('audit_log_tenant_at_idx').on(t.tenantId, t.at),
    index('audit_log_actor_idx').on(t.actorUserId),
  ],
);
