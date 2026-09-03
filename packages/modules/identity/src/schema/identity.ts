import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
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
    /** When a session was last issued. Timing only: there is no column for where. */
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
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
    /**
     * When the university came to trust who this person is, and how: `domain`
     * (their verified email is on the tenant's list) or `admin`. Private. A
     * suspended membership verifies nothing whatever this says.
     */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationMethod: text('verification_method'),
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
    meta: jsonb('meta'),
  },
  (t) => [
    index('audit_log_tenant_at_idx').on(t.tenantId, t.at),
    index('audit_log_actor_idx').on(t.actorUserId),
  ],
);

/**
 * What a person viewed recently, per tenant, so a page can take them straight
 * back. Own rows only. Generic on purpose: a kind, a key, a label and a relative
 * href, so any module can record into it without this one knowing what it is.
 */
export const userRecents = pgTable(
  'user_recents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    /** section | teacher | room */
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** Relative path only. */
    href: text('href').notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_recents_user_tenant_kind_key_uq').on(t.userId, t.tenantId, t.kind, t.key),
    index('user_recents_user_viewed_idx').on(t.userId, t.viewedAt),
  ],
);

/**
 * Asks to be verified in a tenant, from people off its email domain. The
 * details are what an admin checks against the university's records and are
 * PURGED on decision; the row stays, with its status and timestamps, so the
 * rate limit has a memory. Never deleted.
 */
export const verificationRequests = pgTable(
  'verification_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    fullName: text('full_name'),
    rollNumber: text('roll_number'),
    note: text('note'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('verification_requests_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('verification_requests_user_idx').on(t.userId, t.createdAt),
    // One open request per person per tenant, enforced where it cannot race.
    uniqueIndex('verification_requests_one_open_uq')
      .on(t.tenantId, t.userId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * A tenant's roles. Two tenants may both have a role keyed `moderator` meaning
 * different things, and neither can see the other's. System roles ship with
 * every tenant and cannot be deleted, so a tenant cannot remove the role that
 * lets it administer itself.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt,
  },
  (t) => [uniqueIndex('roles_tenant_key_uq').on(t.tenantId, t.key)],
);

/** What a role can do. The permission strings come from the catalogue in core. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    index('role_permissions_tenant_idx').on(t.tenantId),
  ],
);

/**
 * Which roles a member holds. A person may hold several in one tenant, and their
 * effective permissions are the union.
 */
export const membershipRoles = pgTable(
  'membership_roles',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => tenantMemberships.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => universities.slug, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.roleId] }),
    index('membership_roles_user_tenant_idx').on(t.userId, t.tenantId),
  ],
);
