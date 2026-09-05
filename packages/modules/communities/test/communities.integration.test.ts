import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withActorInTenant, withTenant } from '@campusos/db';
import { getDb, getSqlClient } from '@campusos/db/client';
import {
  applyMigrations,
  migrationDatabaseUrl,
  runAsMigrationRole,
  runBaseMigrations,
} from '@campusos/db/migrate';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import { ensureDomainMembership } from '@campusos/module-identity/membership';
import { grantRole } from '@campusos/module-identity/rbac';
import { liftStanding, setStanding, standingFor } from '@campusos/module-identity/standing';
import { ensurePlatformAdmin } from '@campusos/module-identity/platform';
import { createRoleTemplate } from '@campusos/module-identity/role-templates';
import { findOrCreateUser } from '@campusos/module-identity/sessions';
import { communityPermissions, tenantPermissions } from '../src/access';
import { commentsForPost, createComment } from '../src/comments';
import {
  communityBySlug,
  createCommunity,
  joinCommunity,
  leaveCommunity,
  setCommunityRole,
} from '../src/communities';
import { listCommunities, listPendingCommunities, membershipState } from '../src/directory';
import { listCommunityPosts, listPosts, trendingPosts } from '../src/feed';
import { listHeld, listModLog, listQueue } from '../src/queue';
import {
  dissolveCommunity,
  listCommunitiesForOversight,
  listReportedPeople,
  resolveUserReports,
} from '../src/oversight';
import { listNotifications, markRead, unreadCount } from '../src/notifications';
import { listFlairs, setFlairs } from '../src/flairs';
import { crosspost } from '../src/crosspost';
import { describeGate, effectiveGates } from '../src/gates';
import { ownKarma, publicKarma, publicKarmaFor, recomputeKarma } from '../src/karma';
import { commentsByAuthor, isBlocked, profileByHandle } from '../src/profiles';
import { archiveIdle, setArchived } from '../src/archive';
import { pollFor, votePoll } from '../src/polls';
import { searchCommunities, searchPosts } from '../src/search';
import {
  approveItem,
  liftSanction,
  listSanctions,
  movePin,
  muteMember,
  removeItem,
  setLocked,
  setPinned,
} from '../src/mod-actions';
import { listAutomodRules, setAutomodRules } from '../src/automod';
import { blockUser, listBlocked, unblockUser } from '../src/blocks';
import { migrationsFolder, migrationsTable, settingsSchema } from '../src/manifest';
import { listMembers, listModerators } from '../src/members';
import { acceptRules, listRules, needsRulesAcceptance, setRules } from '../src/rules';
import { approveCommunity, updateCommunitySettings } from '../src/settings';
import { banMember, reportItem, unmaskAuthor } from '../src/moderation';
import {
  createPost,
  deletePost,
  editPost,
  myAnonymousPosts,
  postById,
  postHistory,
  postsByAuthor,
} from '../src/posts';
import {
  hideItem,
  listHiddenPosts,
  listSavedComments,
  listSavedPosts,
  saveItem,
} from '../src/saved';
import { postsRead } from '../src/schema/communities';
import { voteComment, votePost } from '../src/votes';

/**
 * The guarantees this module is built on, against a real Postgres: tenant
 * isolation, the roles, one vote per person, and the anonymity model on every
 * read path. The column privilege assertion needs a split database (the
 * application role must not own the tables); it is skipped elsewhere and runs
 * in CI.
 */

const settings = settingsSchema.parse({});
let split = false;

beforeAll(async () => {
  await runBaseMigrations(migrationDatabaseUrl());
  await applyMigrations(
    migrationDatabaseUrl(),
    identityManifest.migrations.folder,
    identityManifest.migrations.table,
  );
  await applyMigrations(migrationDatabaseUrl(), migrationsFolder, migrationsTable);
  const [ownership] = [
    ...(await getDb().execute(sql`
      select pg_get_userbyid(relowner) = current_user as app_owns
      from pg_class where relname = 'posts' and relkind = 'r'`)),
  ] as { app_owns?: boolean }[];
  split = ownership?.app_owns === false;
});

afterAll(async () => {
  await getSqlClient().end();
});

beforeEach(async () => {
  await runAsMigrationRole(
    'truncate table "users" restart identity cascade',
    'truncate table "audit_log" restart identity cascade',
    'truncate table "universities" restart identity cascade',
    // Definitions have no tenant, so the truncate above does not reach them:
    // a definition another run added would still be here and would make the
    // create that follows report `exists`. The six system ones are seeded by
    // the migration and stay.
    'delete from "role_templates" where "is_system" = false',
  );
  // universities is platform-admin-write under RLS (0017), so the app role the
  // suite runs as cannot insert it; the owner seeds it, as with the truncate.
  await runAsMigrationRole(
    `insert into "universities" ("slug","name","timezone") values
       ('aaa','Alpha U','Asia/Karachi'), ('bbb','Beta U','Asia/Karachi')
     on conflict ("slug") do nothing`,
  );
});

const domain = (slug: string) => ({
  slug,
  joinMode: 'domain' as const,
  allowedEmailDomains: [`${slug}.edu`],
});

/** A verified student of the tenant, through the domain rule. */
async function member(subject: string, tenant = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@${tenant}.edu` });
  await ensureDomainMembership(actor, domain(tenant));
  return actor;
}

/** A tenant administrator, seeded as the owner (the config-admin path is retired). */
async function admin(subject: string, tenant = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
  await runAsMigrationRole(
    `select auth_sync_tenant_roles('${tenant}')`,
    `insert into tenant_memberships (tenant_id, user_id, role, status, verified_at, verification_method)
       values ('${tenant}', '${actor.userId}', 'tenant_admin', 'active', now(), 'admin')
       on conflict (tenant_id, user_id) do update
         set role = 'tenant_admin',
             verified_at = coalesce(tenant_memberships.verified_at, now()),
             verification_method = coalesce(tenant_memberships.verification_method, 'admin')`,
    `insert into membership_roles (membership_id, role_id, tenant_id, user_id)
       select m.id, r.id, m.tenant_id, m.user_id
       from tenant_memberships m
       join roles r on r.tenant_id = m.tenant_id and r.key = 'tenant_admin'
       where m.tenant_id = '${tenant}' and m.user_id = '${actor.userId}'
       on conflict (membership_id, role_id) do nothing`,
  );
  return actor;
}

/** Someone with an account and no membership anywhere. */
async function stranger(subject: string) {
  return findOrCreateUser({ subject, email: `${subject}@example.com` });
}

async function community(owner: { userId: string }, name = 'CS Freshers', tenant = 'aaa') {
  const created = await createCommunity(owner, tenant, { name }, settings);
  if (!created.ok) throw new Error(created.error);
  return created.value;
}

describe('row security invariants', () => {
  const FORCED: Record<string, boolean> = {
    communities: true,
    community_rules: true,
    community_mutes: true,
    user_blocks: true,
    post_flairs: true,
    user_flairs: true,
    posts: true,
    post_edits: true,
    // Read by communities_karma_recompute, so FORCE must be off. Their
    // restrictive own-row policy binds the owner too while it is on.
    post_votes: false,
    comments: true,
    comment_edits: true,
    comment_votes: false,
    saved_items: true,
    hidden_items: true,
    reports: true,
    moderation_actions: true,
    automod_rules: true,
    poll_options: true,
    poll_votes: true,
    // Written by communities_notify for a recipient the app never reads, so no FORCE.
    notifications: false,
    // Read by auth_effective_community_permissions, so FORCE must be off.
    community_memberships: false,
    community_member_roles: false,
    community_bans: false,
  };

  it('keeps RLS on every table, and drops FORCE only where the definer function reads', async () => {
    const rows = [
      ...(await getDb().execute(
        sql`select relname, relrowsecurity, relforcerowsecurity from pg_class
            where relname in (${sql.join(
              Object.keys(FORCED).map((t) => sql`${t}`),
              sql`, `,
            )}) and relkind = 'r'`,
      )),
    ] as { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[];
    expect(rows).toHaveLength(Object.keys(FORCED).length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must have RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} FORCE state`).toBe(FORCED[row.relname]);
    }
  });

  it('keeps the karma rebuild beyond the application’s reach', async (ctx) => {
    if (!split) return ctx.skip();
    // The owner's default privileges GRANT EXECUTE ON FUNCTIONS to the
    // application, so a definer meant for the owner alone has to be revoked
    // from it BY NAME; the repository's usual REVOKE ... FROM PUBLIC leaves
    // campusos_app=X standing. 0010 does that, and this holds it done: the
    // rebuild deletes a tenant's karma and reads every author, anonymous
    // included, so nothing a request runs may call it.
    await expect(getDb().execute(sql`select communities_karma_recompute('aaa')`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('communities and roles', () => {
  it("keeps one tenant's communities out of another", async () => {
    const a = await member('iso-a', 'aaa');
    const b = await member('iso-b', 'bbb');
    const c = await community(a, 'Shared Name', 'aaa');
    expect(await communityBySlug('bbb', c.slug)).toBeNull();
    // The same name is free in the other tenant.
    const other = await createCommunity(b, 'bbb', { name: 'Shared Name' }, settings);
    expect(other.ok).toBe(true);
    const post = await createPost(
      a,
      'aaa',
      c.id,
      { kind: 'text', title: 'Hello', body: 'x' },
      settings,
    );
    expect(post.ok).toBe(true);
    const seenFromB = await withTenant('bbb', (tx) => tx.select().from(postsRead));
    expect(seenFromB).toEqual([]);
  });

  it('makes the creator the owner and a joiner a member, and nothing more', async () => {
    const owner = await member('role-owner');
    const joiner = await member('role-joiner');
    const outsider = await member('role-outsider');
    const c = await community(owner);
    expect(await joinCommunity(joiner, 'aaa', c.id, settings)).toEqual({
      ok: true,
      value: { joined: true },
    });
    expect(await joinCommunity(joiner, 'aaa', c.id, settings)).toEqual({
      ok: true,
      value: { joined: false },
    });

    const [o, j, x] = await withActorInTenant(owner.userId, 'aaa', async (tx) => [
      await communityPermissions(tx, owner.userId, 'aaa', c.id),
      await communityPermissions(tx, joiner.userId, 'aaa', c.id),
      await communityPermissions(tx, outsider.userId, 'aaa', c.id),
    ]);
    expect(
      o.hasAll(
        'communities.post',
        'communities.moderate',
        'communities.manage',
        'communities.transfer',
      ),
    ).toBe(true);
    expect(j.hasAll('communities.post', 'communities.comment', 'communities.vote')).toBe(true);
    expect(j.hasAny('communities.moderate', 'communities.manage')).toBe(false);
    expect(x.hasAny('communities.post', 'communities.moderate')).toBe(false);
    // Tenant wide, a student may create communities and nothing else here.
    expect(x.has('communities.create')).toBe(true);
    expect((await communityBySlug('aaa', c.slug))?.memberCount).toBe(2);
  });

  it('lets an owner appoint a moderator, never the last owner leave, and refuses tenant scope', async () => {
    const owner = await member('mod-owner');
    const helper = await member('mod-helper');
    const tenantAdmin = await admin('mod-admin');
    const c = await community(owner);
    await joinCommunity(helper, 'aaa', c.id, settings);

    expect(
      await setCommunityRole(helper, 'aaa', c.id, helper.userId, 'community_moderator', 'grant'),
    ).toEqual({ ok: false, error: 'not_allowed' });
    expect(
      await setCommunityRole(owner, 'aaa', c.id, helper.userId, 'community_moderator', 'grant'),
    ).toEqual({ ok: true, value: { changed: true } });
    const perms = await withActorInTenant(owner.userId, 'aaa', (tx) =>
      communityPermissions(tx, helper.userId, 'aaa', c.id),
    );
    expect(perms.has('communities.moderate')).toBe(true);
    expect(perms.has('communities.manage')).toBe(false);

    expect(await leaveCommunity(owner, 'aaa', c.id)).toEqual({ ok: false, error: 'last_owner' });
    expect(
      await setCommunityRole(owner, 'aaa', c.id, owner.userId, 'community_owner', 'revoke'),
    ).toEqual({ ok: false, error: 'last_owner' });

    // A tenant administrator oversees every community without joining one.
    const oversight = await withActorInTenant(tenantAdmin.userId, 'aaa', (tx) =>
      tenantPermissions(tx, tenantAdmin.userId, 'aaa'),
    );
    expect(oversight.has('communities.oversee')).toBe(true);
    expect(oversight.has('communities.unmask')).toBe(false);

    // Community roles cannot be granted on a tenant membership.
    expect(await grantRole(tenantAdmin, 'aaa', helper.userId, 'community_owner')).toEqual({
      ok: false,
      reason: 'no_such_role',
    });
  });

  it('refuses the unverified and the banned', async () => {
    const owner = await member('ban-owner');
    const target = await member('ban-target');
    const nobody = await stranger('ban-nobody');
    const c = await community(owner);
    expect(await createCommunity(nobody, 'aaa', { name: 'Nope Club' }, settings)).toEqual({
      ok: false,
      error: 'not_verified',
    });
    expect(await joinCommunity(nobody, 'aaa', c.id, settings)).toEqual({
      ok: false,
      error: 'not_verified',
    });

    await joinCommunity(target, 'aaa', c.id, settings);
    expect(await banMember(target, 'aaa', c.id, owner.userId, { reason: 'because' })).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    const banned = await banMember(owner, 'aaa', c.id, target.userId, {
      reason: 'spamming the feed',
    });
    expect(banned.ok).toBe(true);
    const perms = await withActorInTenant(owner.userId, 'aaa', (tx) =>
      communityPermissions(tx, target.userId, 'aaa', c.id),
    );
    expect(perms.size).toBe(0);
    expect(
      await createPost(
        target,
        'aaa',
        c.id,
        { kind: 'text', title: 'Still here?', body: '' },
        settings,
      ),
    ).toEqual({ ok: false, error: 'banned' });
  });
});

describe('votes and ranking', () => {
  it('counts one vote per person, moves it, and recomputes the ranking', async () => {
    const owner = await member('vote-owner');
    const voter = await member('vote-voter');
    const second = await member('vote-second');
    const c = await community(owner);
    await joinCommunity(voter, 'aaa', c.id, settings);
    await joinCommunity(second, 'aaa', c.id, settings);
    const post = await createPost(
      owner,
      'aaa',
      c.id,
      { kind: 'text', title: 'Vote here', body: '' },
      settings,
    );
    if (!post.ok) throw new Error(post.error);
    const before = await postById(null, 'aaa', post.value.id);

    expect(await votePost(voter, 'aaa', post.value.id, 1)).toEqual({
      ok: true,
      value: { upVotes: 1, downVotes: 0, score: 1 },
    });
    expect(await votePost(voter, 'aaa', post.value.id, 1)).toEqual({
      ok: true,
      value: { upVotes: 1, downVotes: 0, score: 1 },
    });
    expect(await votePost(voter, 'aaa', post.value.id, -1)).toEqual({
      ok: true,
      value: { upVotes: 0, downVotes: 1, score: -1 },
    });
    // The author's own vote is refused, so the second upvote is somebody else's.
    expect(await votePost(owner, 'aaa', post.value.id, 1)).toEqual({
      ok: false,
      error: 'self_vote',
    });
    expect(await votePost(second, 'aaa', post.value.id, 1)).toEqual({
      ok: true,
      value: { upVotes: 1, downVotes: 1, score: 0 },
    });
    expect(await votePost(voter, 'aaa', post.value.id, 0)).toEqual({
      ok: true,
      value: { upVotes: 1, downVotes: 0, score: 1 },
    });

    const [row] = await withTenant('aaa', (tx) =>
      tx.select({ hot: postsRead.hotScore, controversy: postsRead.controversy }).from(postsRead),
    );
    expect(Number(row!.hot)).toBeGreaterThan(0);
    expect(before?.score).toBe(0);

    const comment = await createComment(
      voter,
      'aaa',
      post.value.id,
      null,
      { body: 'first' },
      settings,
    );
    if (!comment.ok) throw new Error(comment.error);
    expect(await voteComment(owner, 'aaa', comment.value.id, 1)).toEqual({
      ok: true,
      value: { upVotes: 1, downVotes: 0, score: 1 },
    });
  });
});

describe('the anonymity model', () => {
  async function anonymousPost(author: { userId: string }, communityId: string) {
    const post = await createPost(
      author,
      'aaa',
      communityId,
      { kind: 'text', title: 'Anon', body: 'secret', isAnonymous: true },
      settings,
    );
    if (!post.ok) throw new Error(post.error);
    return post.value.id;
  }

  it('does not let the application role read author_id at all', async (ctx) => {
    if (!split) return ctx.skip();
    const owner = await member('col-owner');
    await expect(
      withActorInTenant(owner.userId, 'aaa', (tx) =>
        tx.execute(sql`select author_id from posts limit 1`),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withActorInTenant(owner.userId, 'aaa', (tx) =>
        tx.execute(sql`select author_id from comments limit 1`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('masks the author from everyone but the author, on every read path', async () => {
    const owner = await member('anon-owner');
    const author = await member('anon-author');
    const tenantAdmin = await admin('anon-admin');
    const c = await community(owner);
    await joinCommunity(author, 'aaa', c.id, settings);
    const postId = await anonymousPost(author, c.id);
    const comment = await createComment(
      author,
      'aaa',
      postId,
      null,
      { body: 'also anon', isAnonymous: true },
      settings,
    );
    if (!comment.ok) throw new Error(comment.error);

    for (const viewer of [null, owner, tenantAdmin]) {
      const post = await postById(viewer, 'aaa', postId);
      expect(post?.isAnonymous).toBe(true);
      expect(post?.author).toBeNull();
      expect(post?.isOwn).toBe(false);
      const [seen] = await commentsForPost(viewer, 'aaa', postId);
      expect(seen?.author).toBeNull();
      expect(seen?.isOwn).toBe(false);
      expect(JSON.stringify({ post, seen })).not.toContain(author.userId);
      expect(JSON.stringify({ post, seen })).not.toContain(author.handle);
    }
    const own = await postById(author, 'aaa', postId);
    expect(own?.isOwn).toBe(true);
    expect(own?.author).toBeNull();

    // The public profile never lists it; the private list does.
    const visible = await createPost(
      author,
      'aaa',
      c.id,
      { kind: 'text', title: 'Signed', body: '' },
      settings,
    );
    expect(visible.ok).toBe(true);
    const profile = await postsByAuthor('aaa', author.userId);
    expect(profile.map((p) => p.title)).toEqual(['Signed']);
    expect((await myAnonymousPosts(author, 'aaa')).map((p) => p.title)).toEqual(['Anon']);

    // The raw table, through the view, carries no author for it either.
    const rows = await withActorInTenant(owner.userId, 'aaa', (tx) => tx.select().from(postsRead));
    expect(rows.find((r) => r.id === postId)?.publicAuthorId).toBeNull();
  });

  it('lets only the author edit or delete an anonymous post', async () => {
    const owner = await member('edit-owner');
    const author = await member('edit-author');
    const c = await community(owner);
    await joinCommunity(author, 'aaa', c.id, settings);
    const postId = await anonymousPost(author, c.id);
    expect(await editPost(owner, 'aaa', postId, { title: 'Hijacked' })).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(await deletePost(owner, 'aaa', postId)).toEqual({ ok: false, error: 'not_allowed' });
    expect(
      await editPost(author, 'aaa', postId, { title: 'Anon, edited', body: 'still secret' }),
    ).toEqual({ ok: true, value: { edited: true } });
    expect((await postById(null, 'aaa', postId))?.editedAt).toBeInstanceOf(Date);
    expect(await deletePost(author, 'aaa', postId)).toEqual({ ok: true, value: { deleted: true } });
  });

  it('unmasks only with the permission and an open report, and logs it exactly once', async () => {
    const owner = await member('unmask-owner');
    const author = await member('unmask-author');
    const reporter = await member('unmask-reporter');
    const tenantAdmin = await admin('unmask-admin');
    const c = await community(owner);
    await joinCommunity(author, 'aaa', c.id, settings);
    await joinCommunity(reporter, 'aaa', c.id, settings);
    const postId = await anonymousPost(author, c.id);

    // A tenant administrator holds everything except this.
    expect(
      await unmaskAuthor(
        tenantAdmin,
        'aaa',
        'post',
        postId,
        '00000000-0000-0000-0000-000000000000',
      ),
    ).toEqual({ ok: false, error: 'not_allowed' });

    // The definition is the platform's, and so is the grant: a tenant
    // administrator does not hold `communities.unmask` and therefore cannot
    // hand it to anyone, themselves included.
    const superAdmin = await findOrCreateUser({
      subject: 'unmask-platform',
      email: 'unmask-platform@gmail.com',
    });
    await ensurePlatformAdmin(superAdmin, ['unmask-platform@gmail.com']);
    const role = await createRoleTemplate(superAdmin, {
      name: 'Trust and Safety',
      permissions: ['communities.unmask'],
    });
    expect(role.ok).toBe(true);
    expect(await grantRole(tenantAdmin, 'aaa', tenantAdmin.userId, 'trust-and-safety')).toEqual({
      ok: false,
      reason: 'above_own',
    });
    expect(await grantRole(superAdmin, 'aaa', tenantAdmin.userId, 'trust-and-safety')).toEqual({
      ok: true,
      changed: true,
    });

    // With the permission but no report: still no.
    expect(
      await unmaskAuthor(
        tenantAdmin,
        'aaa',
        'post',
        postId,
        '00000000-0000-0000-0000-000000000000',
      ),
    ).toEqual({ ok: false, error: 'not_allowed' });

    const report = await reportItem(reporter, 'aaa', {
      itemType: 'post',
      itemId: postId,
      reason: 'harassment',
    });
    if (!report.ok) throw new Error(report.error);
    expect(
      await reportItem(reporter, 'aaa', { itemType: 'post', itemId: postId, reason: 'spam' }),
    ).toEqual({ ok: false, error: 'exists' });

    // The owner of the community, a moderator, cannot: the permission is the gate.
    expect(await unmaskAuthor(owner, 'aaa', 'post', postId, report.value.id)).toEqual({
      ok: false,
      error: 'not_allowed',
    });

    expect(await unmaskAuthor(tenantAdmin, 'aaa', 'post', postId, report.value.id)).toEqual({
      ok: true,
      value: { userId: author.userId },
    });

    const trail = [
      ...(await withActorInTenant(tenantAdmin.userId, 'aaa', (tx) =>
        tx.execute(
          sql`select action, target_id, meta from audit_log where action = 'communities.unmasked'`,
        ),
      )),
    ] as {
      action: string;
      target_id: string;
      meta: { reportId?: string; unmaskedUserId?: string };
    }[];
    expect(trail).toHaveLength(1);
    expect(trail[0]!.target_id).toBe(postId);
    expect(trail[0]!.meta.reportId).toBe(report.value.id);
    expect(trail[0]!.meta.unmaskedUserId).toBe(author.userId);
  });
});

describe('directory, settings, rules and members', () => {
  it('lists live public communities and hides pending or restricted ones', async () => {
    const owner = await member('dir-owner');
    // A second founder: one person may start two a day, and this test needs three.
    const founder = await member('dir-founder');
    const tenantAdmin = await admin('dir-admin');
    await community(owner, 'Open Club');
    const restricted = await createCommunity(
      owner,
      'aaa',
      { name: 'Closed Club', visibility: 'restricted' },
      settings,
    );
    expect(restricted.ok).toBe(true);
    const pending = await createCommunity(
      founder,
      'aaa',
      { name: 'Waiting Club' },
      settingsSchema.parse({ createCommunity: 'approval' }),
    );
    if (!pending.ok) throw new Error(pending.error);
    expect(pending.value.approvalStatus).toBe('pending');

    expect((await listCommunities('aaa')).map((c) => c.name)).toEqual(['Open Club']);
    expect((await listPendingCommunities('aaa')).map((c) => c.name)).toEqual(['Waiting Club']);
    expect(await approveCommunity(owner, 'aaa', pending.value.id)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(await approveCommunity(tenantAdmin, 'aaa', pending.value.id)).toEqual({
      ok: true,
      value: { approved: true },
    });
    expect((await listCommunities('aaa')).map((c) => c.name).sort()).toEqual([
      'Open Club',
      'Waiting Club',
    ]);
  });

  it('changes settings and rules for an owner, logs both, and refuses a member', async () => {
    const owner = await member('set-owner');
    const plain = await member('set-plain');
    const c = await community(owner);
    await joinCommunity(plain, 'aaa', c.id, settings);
    const next = {
      name: 'CS Freshers 2026',
      description: 'For the new intake.',
      allowAnonymous: false,
      visibility: 'public' as const,
      allowedKinds: ['text' as const],
      modLogPublic: true,
    };
    expect(await updateCommunitySettings(plain, 'aaa', c.id, next)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    const updated = await updateCommunitySettings(owner, 'aaa', c.id, next);
    expect(updated.ok && updated.value).toMatchObject({
      slug: c.slug,
      name: 'CS Freshers 2026',
      allowAnonymous: false,
      allowedKinds: ['text'],
    });
    // The slug never moves with the name.
    expect((await communityBySlug('aaa', c.slug))?.name).toBe('CS Freshers 2026');

    expect(await setRules(plain, 'aaa', c.id, [{ title: 'Be kind' }])).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    const rules = await setRules(owner, 'aaa', c.id, [
      { title: 'Be kind', description: 'Argue the point, not the person.' },
      { title: 'Stay on topic' },
    ]);
    expect(rules.ok && rules.value.map((r) => [r.position, r.title])).toEqual([
      [1, 'Be kind'],
      [2, 'Stay on topic'],
    ]);
    const replaced = await setRules(owner, 'aaa', c.id, [{ title: 'Only one now' }]);
    expect(replaced.ok && replaced.value.map((r) => r.title)).toEqual(['Only one now']);
    expect((await listRules('aaa', c.id)).map((r) => r.title)).toEqual(['Only one now']);

    const log = await withActorInTenant(owner.userId, 'aaa', (tx) =>
      tx.execute(
        sql`select action from moderation_actions where community_id = ${c.id}::uuid order by created_at`,
      ),
    );
    expect([...log].map((r) => (r as { action: string }).action)).toEqual([
      'settings.updated',
      'rules.updated',
      'rules.updated',
    ]);
  });

  it("lists members with the owner first and each person's standing", async () => {
    const owner = await member('mem-owner');
    const mod = await member('mem-mod');
    const plain = await member('mem-plain');
    const c = await community(owner);
    await joinCommunity(plain, 'aaa', c.id, settings);
    await joinCommunity(mod, 'aaa', c.id, settings);
    await setCommunityRole(owner, 'aaa', c.id, mod.userId, 'community_moderator', 'grant');

    const members = await listMembers('aaa', c.id);
    expect(members.map((m) => [m.handle, m.roles])).toEqual([
      [owner.handle, ['community_owner']],
      [mod.handle, ['community_moderator']],
      [plain.handle, []],
    ]);
    expect((await listModerators('aaa', c.id)).map((m) => m.handle)).toEqual([
      owner.handle,
      mod.handle,
    ]);
    expect(await membershipState(plain, 'aaa', c.id)).toEqual({
      joined: true,
      roles: ['community_member'],
    });
    expect(await membershipState(owner, 'aaa', c.id)).toEqual({
      joined: true,
      roles: ['community_owner'],
    });
    await leaveCommunity(plain, 'aaa', c.id);
    expect(await membershipState(plain, 'aaa', c.id)).toEqual({ joined: false, roles: [] });
    expect(JSON.stringify(members)).not.toContain('@');
  });
});

describe('post lists, saved and hidden, history', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('pages a community newest first by cursor, and hides what the viewer hid', async () => {
    const owner = await member('feed-owner');
    const c = await community(owner);
    const ids: string[] = [];
    for (const title of ['One', 'Two', 'Three']) {
      const p = await createPost(owner, 'aaa', c.id, { kind: 'text', title, body: '' }, settings);
      if (!p.ok) throw new Error(p.error);
      ids.push(p.value.id);
      await tick();
    }
    const first = await listCommunityPosts(owner, 'aaa', c.id, { limit: 2 });
    expect(first.items.map((p) => p.title)).toEqual(['Three', 'Two']);
    expect(first.nextCursor).not.toBeNull();
    expect(first.items[0]!.community).toEqual({ slug: c.slug, name: c.name });
    const second = await listCommunityPosts(owner, 'aaa', c.id, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((p) => p.title)).toEqual(['One']);
    expect(second.nextCursor).toBeNull();

    expect(await hideItem(owner, 'aaa', 'post', ids[1]!, true)).toEqual({
      ok: true,
      value: { hidden: true },
    });
    expect((await listCommunityPosts(owner, 'aaa', c.id)).items.map((p) => p.title)).toEqual([
      'Three',
      'One',
    ]);
    // Hiding is the viewer's own: everyone else still sees all three.
    expect((await listCommunityPosts(null, 'aaa', c.id)).items).toHaveLength(3);
    expect(
      await hideItem(owner, 'aaa', 'post', '00000000-0000-0000-0000-000000000000', true),
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it("remembers the viewer's vote and saved posts, and keeps edit history without an author", async () => {
    const owner = await member('sv-owner');
    const voter = await member('sv-voter');
    const c = await community(owner);
    await joinCommunity(voter, 'aaa', c.id, settings);
    const p = await createPost(
      owner,
      'aaa',
      c.id,
      { kind: 'text', title: 'Keep me', body: 'v1' },
      settings,
    );
    if (!p.ok) throw new Error(p.error);

    await votePost(voter, 'aaa', p.value.id, 1);
    expect(await saveItem(voter, 'aaa', 'post', p.value.id, true)).toEqual({
      ok: true,
      value: { saved: true },
    });
    expect(await postById(voter, 'aaa', p.value.id)).toMatchObject({
      myVote: 1,
      saved: true,
      score: 1,
    });
    expect(await postById(owner, 'aaa', p.value.id)).toMatchObject({
      myVote: 0,
      saved: false,
      score: 1,
    });
    expect(await postById(null, 'aaa', p.value.id)).toMatchObject({ myVote: 0, saved: false });
    expect((await listSavedPosts(voter, 'aaa')).map((x) => x.id)).toEqual([p.value.id]);
    expect((await listSavedPosts(owner, 'aaa')).length).toBe(0);
    await saveItem(voter, 'aaa', 'post', p.value.id, false);
    expect(await listSavedPosts(voter, 'aaa')).toEqual([]);

    expect(
      await editPost(owner, 'aaa', p.value.id, { title: 'Keep me, edited', body: 'v2' }),
    ).toEqual({
      ok: true,
      value: { edited: true },
    });
    const history = await postHistory('aaa', p.value.id);
    expect(history.map((h) => [h.previousTitle, h.previousBody])).toEqual([['Keep me', 'v1']]);
    expect(JSON.stringify(history)).not.toContain(owner.userId);
    expect((await postById(null, 'aaa', p.value.id))?.editedAt).toBeInstanceOf(Date);
  });
});

describe('comment threads for a viewer', () => {
  it("carries the viewer's vote and saved flag and the public author key, never an anonymous author", async () => {
    const owner = await member('ct-owner');
    const replier = await member('ct-replier');
    const c = await community(owner);
    await joinCommunity(replier, 'aaa', c.id, settings);
    const p = await createPost(
      owner,
      'aaa',
      c.id,
      { kind: 'text', title: 'Thread', body: '' },
      settings,
    );
    if (!p.ok) throw new Error(p.error);
    const root = await createComment(replier, 'aaa', p.value.id, null, { body: 'root' }, settings);
    if (!root.ok) throw new Error(root.error);
    const reply = await createComment(
      owner,
      'aaa',
      p.value.id,
      root.value.id,
      { body: 'anon reply', isAnonymous: true },
      settings,
    );
    if (!reply.ok) throw new Error(reply.error);
    await voteComment(owner, 'aaa', root.value.id, 1);
    expect(await saveItem(owner, 'aaa', 'comment', root.value.id, true)).toEqual({
      ok: true,
      value: { saved: true },
    });

    const asOwner = await commentsForPost(owner, 'aaa', p.value.id);
    expect(asOwner.map((x) => [x.body, x.depth])).toEqual([
      ['root', 0],
      ['anon reply', 1],
    ]);
    expect(asOwner[0]).toMatchObject({
      myVote: 1,
      saved: true,
      score: 1,
      publicAuthorId: replier.userId,
      isOwn: false,
    });
    expect(asOwner[1]).toMatchObject({
      isAnonymous: true,
      publicAuthorId: null,
      author: null,
      isOwn: true,
    });

    const asReplier = await commentsForPost(replier, 'aaa', p.value.id);
    expect(asReplier[0]).toMatchObject({ myVote: 0, saved: false, isOwn: true });
    expect(asReplier[1]).toMatchObject({
      publicAuthorId: null,
      isOwn: false,
      myVote: 0,
      saved: false,
    });
    expect(JSON.stringify(asReplier)).not.toContain(owner.userId);

    const asStranger = await commentsForPost(null, 'aaa', p.value.id);
    expect(asStranger.every((x) => x.myVote === 0 && !x.saved && !x.isOwn)).toBe(true);
    // The post's own public author key is what an OP badge compares against.
    expect((await postById(null, 'aaa', p.value.id))?.publicAuthorId).toBe(owner.userId);
  });
});

describe('sorts and feeds', () => {
  it('orders a community five ways and continues each sort from its cursor', async () => {
    const owner = await member('sf-owner');
    const voters = await Promise.all(['sf-v1', 'sf-v2', 'sf-v3'].map((n) => member(n)));
    const down = await member('sf-down');
    const c = await community(owner, 'Sorted');
    for (const v of [...voters, down]) await joinCommunity(v, 'aaa', c.id, settings);
    const make = async (title: string) => {
      const r = await createPost(owner, 'aaa', c.id, { kind: 'text', title, body: '' }, settings);
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    };
    const a = await make('A');
    const b = await make('B');
    await make('C');
    // A: three up, one down (score 2, split). B: three up (score 3). C: nothing.
    for (const v of voters) await votePost(v, 'aaa', a, 1);
    await votePost(down, 'aaa', a, -1);
    for (const v of voters) await votePost(v, 'aaa', b, 1);

    const titles = async (sort: Parameters<typeof listCommunityPosts>[3]) =>
      (await listCommunityPosts(null, 'aaa', c.id, sort)).items.map((p) => p.title);
    expect(await titles({ sort: 'new' })).toEqual(['C', 'B', 'A']);
    expect(await titles({ sort: 'top', window: 'all' })).toEqual(['B', 'A', 'C']);
    expect(await titles({ sort: 'top', window: 'hour' })).toEqual(['B', 'A', 'C']);
    expect(await titles({ sort: 'hot' })).toEqual(['B', 'A', 'C']);
    expect((await titles({ sort: 'controversial' }))[0]).toBe('A');
    expect(await titles({ sort: 'rising' })).toEqual(['B', 'A', 'C']);

    // The cursor carries the sort key, so the second page continues the order.
    const first = await listCommunityPosts(null, 'aaa', c.id, {
      sort: 'top',
      window: 'all',
      limit: 2,
    });
    expect(first.items.map((p) => p.title)).toEqual(['B', 'A']);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCommunityPosts(null, 'aaa', c.id, {
      sort: 'top',
      window: 'all',
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((p) => p.title)).toEqual(['C']);
    expect(second.nextCursor).toBeNull();
    // A cursor from another sort is ignored, not trusted.
    expect(
      (await listCommunityPosts(null, 'aaa', c.id, { sort: 'hot', cursor: first.nextCursor! }))
        .items,
    ).toHaveLength(3);
    // Rising is a single page.
    expect(
      (await listCommunityPosts(null, 'aaa', c.id, { sort: 'rising', limit: 1 })).nextCursor,
    ).toBeNull();
  });

  it('home is what a person joined; all is the public, approved communities', async () => {
    const o1 = await member('ff-o1');
    const o2 = await member('ff-o2');
    const reader = await member('ff-reader');
    const open = await community(o1, 'Open Hall');
    const made = await createCommunity(
      o2,
      'aaa',
      { name: 'Closed Room', visibility: 'restricted' },
      settings,
    );
    if (!made.ok) throw new Error(made.error);
    const closed = made.value;
    const post = async (who: { userId: string }, id: string, title: string) => {
      const r = await createPost(who, 'aaa', id, { kind: 'text', title, body: '' }, settings);
      if (!r.ok) throw new Error(r.error);
    };
    await post(o1, open.id, 'Open post');
    await post(o2, closed.id, 'Closed post');

    const titles = async (viewer: { userId: string } | null, kind: 'home' | 'all') =>
      (await listPosts(viewer, 'aaa', { kind }, { sort: 'new' })).items.map((p) => p.title);
    // Nobody joined: Home is empty, All has the public post and not the restricted one.
    expect(await titles(reader, 'home')).toEqual([]);
    expect(await titles(reader, 'all')).toContain('Open post');
    expect(await titles(reader, 'all')).not.toContain('Closed post');
    expect(await titles(null, 'all')).not.toContain('Closed post');
    expect(await titles(null, 'home')).toEqual([]);
    // Joining fills Home; a restricted community's member sees it at Home.
    await joinCommunity(reader, 'aaa', open.id, settings);
    expect(await titles(reader, 'home')).toEqual(['Open post']);
    expect(await titles(o2, 'home')).toEqual(['Closed post']);
    // The feed names the community on every card, and the rail's rising list is tenant wide.
    const home = await listPosts(reader, 'aaa', { kind: 'home' });
    expect(home.items[0]?.community).toEqual({ slug: open.slug, name: 'Open Hall' });
    expect((await trendingPosts(null, 'aaa')).map((p) => p.title)).toContain('Open post');
    // Another tenant's feed is another tenant's.
    const other = await member('ff-other', 'bbb');
    expect(
      (await listPosts(other, 'bbb', { kind: 'all' }, { sort: 'new' })).items.map((p) => p.title),
    ).not.toContain('Open post');
  });
});

describe('moderation', () => {
  it('removes and restores with a reason, resolves the reports, and logs every step', async () => {
    const owner = await member('md-owner');
    const writer = await member('md-writer');
    const reporter = await member('md-reporter');
    const c = await community(owner, 'Moderated');
    await joinCommunity(writer, 'aaa', c.id, settings);
    await joinCommunity(reporter, 'aaa', c.id, settings);
    const p = await createPost(
      writer,
      'aaa',
      c.id,
      { kind: 'text', title: 'Reported', body: 'hm' },
      settings,
    );
    if (!p.ok) throw new Error(p.error);
    const cm = await createComment(writer, 'aaa', p.value.id, null, { body: 'rude' }, settings);
    if (!cm.ok) throw new Error(cm.error);
    const report = await reportItem(reporter, 'aaa', {
      itemType: 'post',
      itemId: p.value.id,
      reason: 'spam',
    });
    expect(report.ok).toBe(true);

    // A member is not a moderator.
    expect(await removeItem(writer, 'aaa', 'post', p.value.id, { reason: 'Nope' })).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(await removeItem(owner, 'aaa', 'post', p.value.id, { reason: 'x' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    const queueBefore = await listQueue(owner, 'aaa', c.id);
    expect(queueBefore.ok && queueBefore.value.map((q) => q.itemId)).toEqual([p.value.id]);
    expect(queueBefore.ok && queueBefore.value[0]).toMatchObject({
      itemType: 'post',
      reportCount: 1,
      reasons: ['spam'],
      title: 'Reported',
      isAnonymous: false,
    });
    expect(await listQueue(writer, 'aaa', c.id)).toEqual({ ok: false, error: 'not_allowed' });

    expect(
      await removeItem(owner, 'aaa', 'post', p.value.id, { reason: 'Off topic here' }),
    ).toEqual({ ok: true, value: { removed: true } });
    expect(await postById(null, 'aaa', p.value.id)).toMatchObject({
      removalReason: 'Off topic here',
    });
    expect((await postById(null, 'aaa', p.value.id))?.removedAt).toBeInstanceOf(Date);
    expect((await listCommunityPosts(null, 'aaa', c.id)).items.map((x) => x.id)).not.toContain(
      p.value.id,
    );
    const queueAfter = await listQueue(owner, 'aaa', c.id);
    expect(queueAfter.ok && queueAfter.value).toEqual([]);

    expect(await approveItem(owner, 'aaa', 'post', p.value.id)).toEqual({
      ok: true,
      value: { approved: true },
    });
    expect((await postById(null, 'aaa', p.value.id))?.removedAt).toBeNull();
    expect(await removeItem(owner, 'aaa', 'comment', cm.value.id, { reason: 'Rude' })).toEqual({
      ok: true,
      value: { removed: true },
    });
    expect((await commentsForPost(null, 'aaa', p.value.id))[0]?.removedAt).toBeInstanceOf(Date);

    // The log: newest first, private by default, public when the community says so.
    const log = await listModLog(owner, 'aaa', c.id);
    expect(log.ok && log.value.items.map((e) => e.action)).toEqual([
      'remove_comment',
      'approve_post',
      'remove_post',
    ]);
    expect(log.ok && log.value.items[2]?.reason).toBe('Off topic here');
    expect(await listModLog(null, 'aaa', c.id)).toEqual({ ok: false, error: 'not_allowed' });
    const open = await updateCommunitySettings(owner, 'aaa', c.id, {
      name: 'Moderated',
      description: '',
      allowAnonymous: true,
      visibility: 'public',
      allowedKinds: ['text', 'link'],
      modLogPublic: true,
    });
    expect(open.ok).toBe(true);
    // The settings change logged itself, so the public log is one line longer.
    const publicLog = await listModLog(null, 'aaa', c.id);
    expect(publicLog.ok && publicLog.value.items.map((e) => e.action)).toEqual([
      'settings.updated',
      'remove_comment',
      'approve_post',
      'remove_post',
    ]);
  });

  it('locks, pins within the cap, and leads a community with its pins', async () => {
    const owner = await member('pin-owner');
    const m = await member('pin-member');
    const c = await community(owner, 'Pinned Hall');
    await joinCommunity(m, 'aaa', c.id, settings);
    const ids: string[] = [];
    for (const title of ['P1', 'P2', 'P3', 'P4']) {
      const r = await createPost(owner, 'aaa', c.id, { kind: 'text', title, body: '' }, settings);
      if (!r.ok) throw new Error(r.error);
      ids.push(r.value.id);
    }
    const [p1, p2, p3, p4] = ids as [string, string, string, string];

    expect(await setLocked(owner, 'aaa', p1, true)).toEqual({ ok: true, value: { locked: true } });
    expect(await createComment(m, 'aaa', p1, null, { body: 'late' }, settings)).toEqual({
      ok: false,
      error: 'locked',
    });
    expect(await setLocked(m, 'aaa', p1, false)).toEqual({ ok: false, error: 'not_allowed' });
    await setLocked(owner, 'aaa', p1, false);
    expect((await createComment(m, 'aaa', p1, null, { body: 'in time' }, settings)).ok).toBe(true);

    for (const id of [p1, p2, p3]) {
      expect(await setPinned(owner, 'aaa', id, true, settings)).toEqual({
        ok: true,
        value: { pinned: true },
      });
    }
    expect(await setPinned(owner, 'aaa', p4, true, settings)).toEqual({
      ok: false,
      error: 'pin_cap',
    });
    // Pins lead the first page in every sort, outside the cursor; the rest follow.
    const page = await listCommunityPosts(null, 'aaa', c.id, { sort: 'new', limit: 1 });
    expect(page.items.map((p) => p.id)).toEqual([p3, p2, p1, p4]);
    expect(page.items.slice(0, 3).every((p) => p.pinnedAt !== null)).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(await setPinned(owner, 'aaa', p1, false, settings)).toEqual({
      ok: true,
      value: { pinned: false },
    });
    expect((await setPinned(owner, 'aaa', p4, true, settings)).ok).toBe(true);
    const log = await listModLog(owner, 'aaa', c.id, { limit: 2 });
    expect(log.ok && log.value.items.map((e) => e.action)).toEqual(['pin', 'unpin']);
    expect(log.ok && log.value.nextCursor).not.toBeNull();
  });

  it('mutes, bans and lifts, naming the member only to moderators', async () => {
    const owner = await member('mu-owner');
    const m = await member('mu-member');
    const c = await community(owner, 'Quiet Room');
    await joinCommunity(m, 'aaa', c.id, settings);
    // Distinct titles: the same title again in a day is a repeat since A7.
    let n = 0;
    const post = () =>
      createPost(m, 'aaa', c.id, { kind: 'text', title: `Hello there ${++n}`, body: '' }, settings);

    expect(await muteMember(owner, 'aaa', c.id, owner.userId, { reason: 'Myself' })).toEqual({
      ok: false,
      error: 'self',
    });
    const mute = await muteMember(owner, 'aaa', c.id, m.userId, {
      reason: 'Cool off',
      minutes: 60,
    });
    if (!mute.ok) throw new Error(mute.error);
    expect(await post()).toEqual({ ok: false, error: 'muted' });
    const active = await listSanctions(owner, 'aaa', c.id);
    expect(active.ok && active.value.map((s) => [s.kind, s.reason])).toEqual([
      ['mute', 'Cool off'],
    ]);
    expect(active.ok && active.value[0]?.handle).not.toBe('');
    expect(await listSanctions(m, 'aaa', c.id)).toEqual({ ok: false, error: 'not_allowed' });
    expect(await liftSanction(m, 'aaa', 'mute', mute.value.id)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(await liftSanction(owner, 'aaa', 'mute', mute.value.id)).toEqual({
      ok: true,
      value: { lifted: true },
    });
    expect((await post()).ok).toBe(true);

    const ban = await banMember(owner, 'aaa', c.id, m.userId, { reason: 'Kept at it' });
    if (!ban.ok) throw new Error(ban.error);
    expect(await post()).toEqual({ ok: false, error: 'banned' });
    expect(await liftSanction(owner, 'aaa', 'ban', ban.value.id)).toEqual({
      ok: true,
      value: { lifted: true },
    });
    expect((await post()).ok).toBe(true);

    const log = await listModLog(owner, 'aaa', c.id, { limit: 4 });
    expect(log.ok && log.value.items.map((e) => e.action)).toEqual([
      'unban',
      'ban',
      'unmute',
      'mute',
    ]);
    expect(log.ok && log.value.items.every((e) => e.targetHandle !== null)).toBe(true);
    const opened = await updateCommunitySettings(owner, 'aaa', c.id, {
      name: 'Quiet Room',
      description: '',
      allowAnonymous: true,
      visibility: 'public',
      allowedKinds: ['text'],
      modLogPublic: true,
    });
    if (!opened.ok) throw new Error(opened.error);
    const publicLog = await listModLog(null, 'aaa', c.id, { limit: 4 });
    if (!publicLog.ok) throw new Error(publicLog.error);
    // The newest line is the settings change itself; the member lines carry no handle and no id.
    const aboutMembers = publicLog.value.items.filter((e) => e.targetType === 'user');
    expect(aboutMembers.length).toBeGreaterThanOrEqual(3);
    expect(aboutMembers.every((e) => e.targetHandle === null && e.targetId === '')).toBe(true);
  });

  it("blocking hides a person's signed posts and comments from the blocker alone", async () => {
    const owner = await member('bl-owner');
    const blocker = await member('bl-blocker');
    const other = await member('bl-other');
    const c = await community(owner, 'Blocks');
    await joinCommunity(blocker, 'aaa', c.id, settings);
    await joinCommunity(other, 'aaa', c.id, settings);
    const signed = await createPost(
      other,
      'aaa',
      c.id,
      { kind: 'text', title: 'Signed post', body: '' },
      settings,
    );
    const anon = await createPost(
      other,
      'aaa',
      c.id,
      { kind: 'text', title: 'Anonymous post', body: '', isAnonymous: true },
      settings,
    );
    const mine = await createPost(
      blocker,
      'aaa',
      c.id,
      { kind: 'text', title: 'Mine', body: '' },
      settings,
    );
    if (!signed.ok || !anon.ok || !mine.ok) throw new Error('setup');
    const reply = await createComment(other, 'aaa', mine.value.id, null, { body: 'hey' }, settings);
    if (!reply.ok) throw new Error(reply.error);

    expect(await blockUser(blocker, 'aaa', blocker.userId)).toEqual({ ok: false, error: 'self' });
    expect(await blockUser(blocker, 'aaa', other.userId)).toEqual({
      ok: true,
      value: { blocked: true },
    });
    const titles = async (viewer: { userId: string } | null) =>
      (await listCommunityPosts(viewer, 'aaa', c.id, { sort: 'new' })).items.map((p) => p.title);
    expect(await titles(blocker)).toEqual(['Mine', 'Anonymous post']);
    expect(await titles(owner)).toEqual(['Mine', 'Anonymous post', 'Signed post']);
    expect(await titles(null)).toContain('Signed post');
    const thread = await commentsForPost(blocker, 'aaa', mine.value.id);
    expect(thread[0]).toMatchObject({ blocked: true, body: '', author: null });
    expect((await commentsForPost(owner, 'aaa', mine.value.id))[0]).toMatchObject({
      blocked: false,
      body: 'hey',
    });
    expect((await listBlocked(blocker, 'aaa')).map((b) => b.userId)).toEqual([other.userId]);
    expect(await listBlocked(other, 'aaa')).toEqual([]);
    expect(await unblockUser(blocker, 'aaa', other.userId)).toEqual({
      ok: true,
      value: { blocked: false },
    });
    expect(await titles(blocker)).toContain('Signed post');
  });

  it('lets the tenant oversee every community and dissolve one, and nobody else', async () => {
    const overseer = await admin('ov-admin');
    const o1 = await member('ov-o1');
    const o2 = await member('ov-o2');
    const reporter = await member('ov-reporter');
    const c1 = await community(o1, 'Overseen One');
    const c2 = await community(o2, 'Overseen Two');
    await joinCommunity(reporter, 'aaa', c1.id, settings);
    await joinCommunity(reporter, 'aaa', c2.id, settings);
    for (const [who, c] of [
      [o1, c1],
      [o2, c2],
    ] as const) {
      const p = await createPost(
        who,
        'aaa',
        c.id,
        { kind: 'text', title: 'Seen', body: '' },
        settings,
      );
      if (!p.ok) throw new Error(p.error);
      await reportItem(reporter, 'aaa', { itemType: 'post', itemId: p.value.id, reason: 'other' });
    }

    expect(await listQueue(o1, 'aaa', null)).toEqual({ ok: false, error: 'not_allowed' });
    const queue = await listQueue(overseer, 'aaa', null);
    expect(queue.ok && queue.value.map((q) => q.communityId).sort()).toEqual([c1.id, c2.id].sort());
    const list = await listCommunitiesForOversight(overseer, 'aaa');
    expect(list.ok && list.value.find((c) => c.id === c2.id)).toMatchObject({ openReports: 1 });
    expect(await listCommunitiesForOversight(o1, 'aaa')).toEqual({
      ok: false,
      error: 'not_allowed',
    });

    expect(await dissolveCommunity(o1, 'aaa', c2.id, { reason: 'I want it gone' })).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(await dissolveCommunity(overseer, 'aaa', c2.id, { reason: 'Duplicate of One' })).toEqual(
      {
        ok: true,
        value: { dissolved: true },
      },
    );
    expect(await communityBySlug('aaa', c2.slug)).toBeNull();
    expect(await dissolveCommunity(overseer, 'aaa', c2.id, { reason: 'Again' })).toEqual({
      ok: true,
      value: { dissolved: false },
    });
    const after = await listCommunitiesForOversight(overseer, 'aaa');
    expect(after.ok && after.value.some((c) => c.id === c2.id)).toBe(false);
  });
});

describe('anti abuse', () => {
  it('holds or removes by a filter, keeps the rules to moderators, and lets a moderator restore', async () => {
    const owner = await member('am-owner');
    const m = await member('am-member');
    const c = await community(owner, 'Filtered');
    await joinCommunity(m, 'aaa', c.id, settings);
    expect(await setAutomodRules(m, 'aaa', c.id, [])).toEqual({ ok: false, error: 'not_allowed' });
    expect(await listAutomodRules(m, 'aaa', c.id)).toEqual({ ok: false, error: 'not_allowed' });
    const set = await setAutomodRules(owner, 'aaa', c.id, [
      { kind: 'keyword', pattern: 'Crypto Giveaway', action: 'queue' },
      { kind: 'domain', pattern: 'spam.example', action: 'remove' },
    ]);
    expect(set.ok && set.value.map((r) => [r.kind, r.action])).toEqual([
      ['keyword', 'queue'],
      ['domain', 'remove'],
    ]);

    const held = await createPost(
      m,
      'aaa',
      c.id,
      { kind: 'text', title: 'Free CRYPTO giveaway tonight', body: '' },
      settings,
    );
    expect(held.ok && held.value.held).toBe(true);
    if (!held.ok) throw new Error(held.error);
    // Held: out of the feed, visible to its author with the reason code, in the Held tab.
    expect((await listCommunityPosts(null, 'aaa', c.id)).items.map((p) => p.id)).not.toContain(
      held.value.id,
    );
    expect(await postById(m, 'aaa', held.value.id)).toMatchObject({
      isOwn: true,
      removalReason: 'automod:queue',
    });
    const list = await listHeld(owner, 'aaa', c.id);
    expect(list.ok && list.value.map((h) => [h.itemId, h.reason])).toEqual([
      [held.value.id, 'filter_hold'],
    ]);
    const log = await listModLog(owner, 'aaa', c.id, { limit: 1 });
    expect(log.ok && log.value.items[0]).toMatchObject({
      action: 'automod_hold',
      system: true,
      actorHandle: null,
    });
    expect(log.ok && log.value.items[0]?.meta).toMatchObject({ pattern: 'Crypto Giveaway' });
    expect(await approveItem(owner, 'aaa', 'post', held.value.id)).toEqual({
      ok: true,
      value: { approved: true },
    });
    expect((await postById(null, 'aaa', held.value.id))?.removedAt).toBeNull();
    expect(
      (await listHeld(owner, 'aaa', c.id)).ok && (await listHeld(owner, 'aaa', c.id)),
    ).toMatchObject({ value: [] });

    const removed = await createPost(
      m,
      'aaa',
      c.id,
      { kind: 'link', title: 'Look at this', url: 'https://www.spam.example/offer' },
      settings,
    );
    expect(removed.ok && removed.value.held).toBe(true);
    if (!removed.ok) throw new Error(removed.error);
    expect(await postById(m, 'aaa', removed.value.id)).toMatchObject({
      removalReason: 'automod:remove',
    });
    const clean = await createPost(
      m,
      'aaa',
      c.id,
      { kind: 'text', title: 'Study group tonight', body: 'Library, 7pm' },
      settings,
    );
    expect(clean.ok && clean.value.held).toBe(false);
    // A comment is screened the same way.
    if (!clean.ok) throw new Error(clean.error);
    const cm = await createComment(
      m,
      'aaa',
      clean.value.id,
      null,
      { body: 'crypto giveaway, dm me' },
      settings,
    );
    if (!cm.ok) throw new Error(cm.error);
    expect((await commentsForPost(owner, 'aaa', clean.value.id))[0]?.removedAt).toBeInstanceOf(
      Date,
    );
    const heldNow = await listHeld(owner, 'aaa', c.id);
    expect(heldNow.ok && heldNow.value.map((h) => h.itemType).sort()).toEqual(['comment', 'post']);
  });

  it('hides an item at the report threshold until a moderator looks, and refuses a repeated title', async () => {
    const owner = await member('rt-owner');
    const writer = await member('rt-writer');
    const reporters = await Promise.all(['rt-r1', 'rt-r2', 'rt-r3'].map((n) => member(n)));
    const c = await community(owner, 'Thresholds');
    for (const who of [writer, ...reporters]) await joinCommunity(who, 'aaa', c.id, settings);
    const p = await createPost(
      writer,
      'aaa',
      c.id,
      { kind: 'text', title: 'Borderline', body: '' },
      settings,
    );
    if (!p.ok) throw new Error(p.error);
    expect(
      await createPost(
        writer,
        'aaa',
        c.id,
        { kind: 'text', title: 'Borderline', body: '' },
        settings,
      ),
    ).toEqual({ ok: false, error: 'exists' });

    const report = (who: { userId: string }) =>
      reportItem(who, 'aaa', { itemType: 'post', itemId: p.value.id, reason: 'spam' }, settings);
    expect(await report(reporters[0]!)).toMatchObject({ ok: true, value: { hidden: false } });
    expect(await report(reporters[1]!)).toMatchObject({ ok: true, value: { hidden: false } });
    expect((await postById(null, 'aaa', p.value.id))?.removedAt).toBeNull();
    expect(await report(reporters[2]!)).toMatchObject({ ok: true, value: { hidden: true } });
    expect(await postById(null, 'aaa', p.value.id)).toMatchObject({
      removalReason: 'auto:reports',
    });
    expect((await listCommunityPosts(null, 'aaa', c.id)).items.map((x) => x.id)).not.toContain(
      p.value.id,
    );
    const held = await listHeld(owner, 'aaa', c.id);
    expect(held.ok && held.value.map((h) => h.reason)).toEqual(['reports']);
    const queue = await listQueue(owner, 'aaa', c.id);
    expect(queue.ok && queue.value[0]).toMatchObject({ itemId: p.value.id, reportCount: 3 });
    expect(queue.ok && queue.value[0]?.removedAt).toBeInstanceOf(Date);
    const log = await listModLog(owner, 'aaa', c.id, { limit: 1 });
    expect(log.ok && log.value.items[0]).toMatchObject({ action: 'auto_hide', system: true });
    // A moderator's approve restores it and clears the reports in one go.
    expect((await approveItem(owner, 'aaa', 'post', p.value.id)).ok).toBe(true);
    expect((await postById(null, 'aaa', p.value.id))?.removedAt).toBeNull();
    expect(
      (await listQueue(owner, 'aaa', c.id)).ok && (await listQueue(owner, 'aaa', c.id)),
    ).toMatchObject({ value: [] });
  });
});

describe('polls', () => {
  it('takes one final vote per person, shows counts to all and the choice to its owner alone', async () => {
    const owner = await member('poll-owner');
    const a = await member('poll-a');
    const b = await member('poll-b');
    const made = await createCommunity(
      owner,
      'aaa',
      { name: 'Poll Hall', allowedKinds: ['text', 'poll'] },
      settings,
    );
    if (!made.ok) throw new Error(made.error);
    const c = made.value;
    await joinCommunity(a, 'aaa', c.id, settings);
    await joinCommunity(b, 'aaa', c.id, settings);

    expect(
      await createPost(
        owner,
        'aaa',
        c.id,
        { kind: 'poll', title: 'No options', body: '' },
        settings,
      ),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      await createPost(
        owner,
        'aaa',
        c.id,
        { kind: 'poll', title: 'Repeats', poll: { options: ['Tea', 'tea'] } },
        settings,
      ),
    ).toEqual({ ok: false, error: 'invalid' });
    const p = await createPost(
      owner,
      'aaa',
      c.id,
      {
        kind: 'poll',
        title: 'Best study spot?',
        body: 'Be honest.',
        poll: { options: ['Library', 'Cafeteria', 'Lawn'], closesInHours: 48 },
      },
      settings,
    );
    if (!p.ok) throw new Error(p.error);
    expect(p.value.held).toBe(false);

    const fresh = await pollFor(null, 'aaa', p.value.id);
    expect(fresh?.options.map((o) => [o.text, o.votes, o.share])).toEqual([
      ['Library', 0, 0],
      ['Cafeteria', 0, 0],
      ['Lawn', 0, 0],
    ]);
    expect(fresh).toMatchObject({ total: 0, closed: false, myOptionId: null });
    expect(fresh!.closesAt.getTime() - Date.now()).toBeGreaterThan(47 * 3_600_000);
    expect((await postById(null, 'aaa', p.value.id))?.pollClosesAt).toEqual(fresh!.closesAt);

    const [library, cafeteria] = fresh!.options.map((o) => o.id) as [string, string, string];
    const voted = await votePoll(a, 'aaa', p.value.id, library);
    expect(voted.ok && voted.value).toMatchObject({ total: 1, myOptionId: library });
    expect(voted.ok && voted.value.options[0]).toMatchObject({ votes: 1, share: 100 });
    // Final: a second vote, for anything, is refused.
    expect(await votePoll(a, 'aaa', p.value.id, cafeteria)).toEqual({ ok: false, error: 'exists' });
    expect(await votePoll(a, 'aaa', p.value.id, library)).toEqual({ ok: false, error: 'exists' });
    await votePoll(b, 'aaa', p.value.id, cafeteria);

    // Counts for everyone; the choice for its owner only.
    const asB = await pollFor(b, 'aaa', p.value.id);
    expect(asB?.options.map((o) => [o.votes, o.share])).toEqual([
      [1, 50],
      [1, 50],
      [0, 0],
    ]);
    expect(asB?.myOptionId).toBe(cafeteria);
    expect((await pollFor(owner, 'aaa', p.value.id))?.myOptionId).toBeNull();
    expect((await pollFor(null, 'aaa', p.value.id))?.myOptionId).toBeNull();

    // An option from elsewhere, a stranger, a community without polls.
    const other = await createPost(
      owner,
      'aaa',
      c.id,
      { kind: 'poll', title: 'Other poll', poll: { options: ['Yes', 'No'] } },
      settings,
    );
    if (!other.ok) throw new Error(other.error);
    const otherOption = (await pollFor(null, 'aaa', other.value.id))!.options[0]!.id;
    expect(await votePoll(owner, 'aaa', p.value.id, otherOption)).toEqual({
      ok: false,
      error: 'invalid',
    });
    const outsider = await member('poll-outsider');
    expect(await votePoll(outsider, 'aaa', p.value.id, library)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    const plain = await community(owner, 'Text Only');
    expect(
      await createPost(
        owner,
        'aaa',
        plain.id,
        { kind: 'poll', title: 'Nope', poll: { options: ['A', 'B'] } },
        settings,
      ),
    ).toEqual({ ok: false, error: 'kind_not_allowed' });
    // A text post has no poll.
    expect(await pollFor(null, 'aaa', plain.id)).toBeNull();
  });
});

describe('notifications', () => {
  it('tells an author who replied under a handle, "someone" for an anonymous one, and nobody about themselves', async () => {
    const owner = await member('nf-owner');
    const m = await member('nf-member');
    const other = await member('nf-other');
    const c = await community(owner, 'Inbox Hall');
    await joinCommunity(m, 'aaa', c.id, settings);
    await joinCommunity(other, 'aaa', c.id, settings);
    const p = await createPost(
      owner,
      'aaa',
      c.id,
      { kind: 'text', title: 'Tell me things', body: '' },
      settings,
    );
    if (!p.ok) throw new Error(p.error);

    // A signed comment names its author; an anonymous one does not; the author's own comment tells nobody.
    const signed = await createComment(m, 'aaa', p.value.id, null, { body: 'hello' }, settings);
    if (!signed.ok) throw new Error(signed.error);
    await createComment(
      other,
      'aaa',
      p.value.id,
      null,
      { body: 'psst', isAnonymous: true },
      settings,
    );
    await createComment(owner, 'aaa', p.value.id, null, { body: 'my own' }, settings);
    const inbox = await listNotifications(owner, 'aaa');
    expect(inbox.items.map((n) => [n.kind, n.actor?.handle ?? null])).toEqual([
      ['comment_on_post', null],
      ['comment_on_post', expect.any(String)],
    ]);
    expect(inbox.items[1]?.actor?.handle).not.toBe('');
    expect(
      inbox.items.every((n) => n.postId === p.value.id && n.postTitle === 'Tell me things'),
    ).toBe(true);
    expect(JSON.stringify(inbox)).not.toContain(other.userId);
    expect(await unreadCount(owner, 'aaa')).toBe(2);
    // Nobody else's inbox has these.
    expect((await listNotifications(m, 'aaa')).items).toEqual([]);
    expect(await unreadCount(other, 'aaa')).toBe(0);

    // A reply tells the parent's author, not the post's; a self reply tells nobody.
    const reply = await createComment(
      owner,
      'aaa',
      p.value.id,
      signed.value.id,
      { body: 'thanks' },
      settings,
    );
    if (!reply.ok) throw new Error(reply.error);
    await createComment(m, 'aaa', p.value.id, signed.value.id, { body: 'me again' }, settings);
    const mInbox = await listNotifications(m, 'aaa');
    expect(mInbox.items.map((n) => [n.kind, n.commentId])).toEqual([['reply', reply.value.id]]);
    expect(await unreadCount(owner, 'aaa')).toBe(2);

    // A removal tells the author it happened, not who did it.
    expect(
      (await removeItem(owner, 'aaa', 'comment', signed.value.id, { reason: 'Off topic' })).ok,
    ).toBe(true);
    const afterRemoval = await listNotifications(m, 'aaa');
    expect(afterRemoval.items[0]).toMatchObject({ kind: 'comment_removed', actor: null });
    expect(await unreadCount(m, 'aaa')).toBe(2);

    // Marking read: some, then all; own rows only.
    expect(await markRead(m, 'aaa', [afterRemoval.items[0]!.id])).toEqual({ marked: 1 });
    expect(await unreadCount(m, 'aaa')).toBe(1);
    expect(await markRead(owner, 'aaa', [afterRemoval.items[1]!.id])).toEqual({ marked: 0 });
    expect(await markRead(m, 'aaa', 'all')).toEqual({ marked: 1 });
    expect(await unreadCount(m, 'aaa')).toBe(0);
    expect((await listNotifications(m, 'aaa')).items.every((n) => n.readAt !== null)).toBe(true);
    // Paging.
    const first = await listNotifications(owner, 'aaa', { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listNotifications(owner, 'aaa', { limit: 1, cursor: first.nextCursor! });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});

describe('search and the directory', () => {
  it('finds posts by title and text within what the viewer may see, and communities by name', async () => {
    const owner = await member('se-owner');
    const reader = await member('se-reader');
    const open = await community(owner, 'Chess Society');
    const made = await createCommunity(
      owner,
      'aaa',
      { name: 'Quiet Chess Room', visibility: 'restricted', description: 'Endgames only' },
      settings,
    );
    if (!made.ok) throw new Error(made.error);
    const closed = made.value;
    const post = async (c: string, title: string, body = '') => {
      const r = await createPost(owner, 'aaa', c, { kind: 'text', title, body }, settings);
      if (!r.ok) throw new Error(r.error);
      return r.value.id;
    };
    const gambit = await post(open.id, 'Queen gambit night', 'Bring a board and a clock.');
    const clocks = await post(open.id, 'Lost property', 'Someone left a chess clock behind');
    const hidden = await post(closed.id, 'Gambit lines for members', '');
    const gone = await post(open.id, 'Gambit spam', '');
    expect((await removeItem(owner, 'aaa', 'post', gone, { reason: 'Spam' })).ok).toBe(true);

    const ids = async (viewer: { userId: string } | null, q: string) =>
      (await searchPosts(viewer, 'aaa', q)).map((p) => p.id);
    // Title and body both count; a removed post never shows; short queries find nothing.
    expect(await ids(null, 'gambit')).toEqual([gambit]);
    expect((await searchPosts(null, 'aaa', 'clock')).map((p) => p.title).sort()).toEqual([
      'Lost property',
      'Queen gambit night',
    ]);
    expect(await ids(null, 'g')).toEqual([]);
    expect(await ids(null, '"chess clock"')).toEqual([clocks]);
    // A restricted community's posts are for its members: the owner is one, the reader is not.
    expect(await ids(reader, 'gambit')).toEqual([gambit]);
    expect(await ids(owner, 'gambit')).toEqual(expect.arrayContaining([gambit, hidden]));
    expect(await ids(null, 'gambit')).toEqual([gambit]);
    // A result names its community.
    const found = await searchPosts(owner, 'aaa', 'gambit');
    expect(found.map((p) => p.community.slug).sort()).toEqual([closed.slug, open.slug].sort());

    // Communities: public and approved only, by name or description.
    expect((await searchCommunities('aaa', 'chess')).map((c) => c.id)).toEqual([open.id]);
    expect((await searchCommunities('aaa', 'endgames')).map((c) => c.id)).toEqual([]);
    expect(await searchCommunities('aaa', 'c')).toEqual([]);

    // The directory's orders.
    const byMembers = await listCommunities('aaa', 100, 'members');
    const byNew = await listCommunities('aaa', 100, 'new');
    const byName = await listCommunities('aaa', 100, 'name');
    expect(byNew[0]?.id).toBe(open.id);
    const names = byName.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(byMembers.map((c) => c.id)).toEqual(expect.arrayContaining([open.id]));
    expect(byMembers.map((c) => c.id)).not.toContain(closed.id);
  });
});

describe('flairs, pins in order, crossposts', () => {
  it('keeps flairs by id, lets a post wear one, and filters by it', async () => {
    const owner = await member('fl-owner');
    const m = await member('fl-member');
    const c = await community(owner, 'Flair Hall');
    const other = await community(owner, 'Other Hall');
    await joinCommunity(m, 'aaa', c.id, settings);
    expect(await setFlairs(m, 'aaa', c.id, [{ name: 'Q', color: '#000000' }])).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(
      await setFlairs(owner, 'aaa', c.id, [
        { name: 'Same', color: '#000000' },
        { name: 'same', color: '#111111' },
      ]),
    ).toEqual({
      ok: false,
      error: 'invalid',
    });
    const first = await setFlairs(owner, 'aaa', c.id, [
      { name: 'Question', color: '#1D4ED8' },
      { name: 'Notice', color: '#b45309' },
    ]);
    if (!first.ok) throw new Error(first.error);
    expect(first.value.map((f) => [f.name, f.color, f.position])).toEqual([
      ['Question', '#1d4ed8', 1],
      ['Notice', '#b45309', 2],
    ]);
    const question = first.value[0]!;
    const notice = first.value[1]!;

    // The other community's flair is not this one's.
    const theirs = await setFlairs(owner, 'aaa', other.id, [
      { name: 'Elsewhere', color: '#000000' },
    ]);
    if (!theirs.ok) throw new Error(theirs.error);
    expect(
      await createPost(
        m,
        'aaa',
        c.id,
        { kind: 'text', title: 'Wrong flair', body: '', flairId: theirs.value[0]!.id },
        settings,
      ),
    ).toEqual({ ok: false, error: 'invalid' });
    const worn = await createPost(
      m,
      'aaa',
      c.id,
      { kind: 'text', title: 'Where is B block?', body: '', flairId: question.id },
      settings,
    );
    if (!worn.ok) throw new Error(worn.error);
    const bare = await createPost(
      m,
      'aaa',
      c.id,
      { kind: 'text', title: 'No flair here', body: '' },
      settings,
    );
    if (!bare.ok) throw new Error(bare.error);
    expect((await postById(null, 'aaa', worn.value.id))?.flairId).toBe(question.id);
    expect(
      (await listCommunityPosts(null, 'aaa', c.id, { flairId: question.id })).items.map(
        (p) => p.id,
      ),
    ).toEqual([worn.value.id]);
    expect((await listCommunityPosts(null, 'aaa', c.id, { flairId: notice.id })).items).toEqual([]);
    expect((await listCommunityPosts(null, 'aaa', c.id)).items).toHaveLength(2);

    // Rename by id: the post keeps it. Drop the other: gone from the list.
    const second = await setFlairs(owner, 'aaa', c.id, [
      { id: question.id, name: 'Questions', color: '#1d4ed8' },
    ]);
    if (!second.ok) throw new Error(second.error);
    expect(second.value.map((f) => [f.id, f.name])).toEqual([[question.id, 'Questions']]);
    expect((await listFlairs('aaa', c.id)).map((f) => f.name)).toEqual(['Questions']);
    expect((await postById(null, 'aaa', worn.value.id))?.flairId).toBe(question.id);
    // Dropping the worn one takes it off the post.
    const none = await setFlairs(owner, 'aaa', c.id, []);
    expect(none.ok && none.value).toEqual([]);
    expect((await postById(null, 'aaa', worn.value.id))?.flairId).toBeNull();
  });

  it('reorders pins by moving one up or down, moderators only', async () => {
    const owner = await member('po-owner');
    const m = await member('po-member');
    const c = await community(owner, 'Pin Order');
    await joinCommunity(m, 'aaa', c.id, settings);
    const ids: string[] = [];
    for (const title of ['One', 'Two', 'Three']) {
      const r = await createPost(owner, 'aaa', c.id, { kind: 'text', title, body: '' }, settings);
      if (!r.ok) throw new Error(r.error);
      ids.push(r.value.id);
      expect((await setPinned(owner, 'aaa', r.value.id, true, settings)).ok).toBe(true);
    }
    const [one, two, three] = ids as [string, string, string];
    const order = async () =>
      (await listCommunityPosts(null, 'aaa', c.id, { limit: 1 })).items
        .filter((p) => p.pinnedAt !== null)
        .map((p) => p.title);
    expect(await order()).toEqual(['Three', 'Two', 'One']);
    expect(await movePin(m, 'aaa', one, 'up')).toEqual({ ok: false, error: 'not_allowed' });
    expect(await movePin(owner, 'aaa', one, 'up')).toEqual({ ok: true, value: { moved: true } });
    expect(await order()).toEqual(['Three', 'One', 'Two']);
    expect(await movePin(owner, 'aaa', three, 'up')).toEqual({ ok: true, value: { moved: false } });
    expect(await movePin(owner, 'aaa', three, 'down')).toEqual({
      ok: true,
      value: { moved: true },
    });
    expect(await order()).toEqual(['One', 'Three', 'Two']);
    await setPinned(owner, 'aaa', two, false, settings);
    expect(await movePin(owner, 'aaa', two, 'up')).toEqual({ ok: false, error: 'not_found' });
    const log = await listModLog(owner, 'aaa', c.id, { limit: 3 });
    expect(log.ok && log.value.items.map((e) => e.action)).toEqual([
      'unpin',
      'pin_order',
      'pin_order',
    ]);
  });

  it('crossposts into a community the person belongs to, once, naming a public original', async () => {
    const owner = await member('xp-owner');
    const m = await member('xp-member');
    const home = await community(owner, 'Origin Hall');
    const target = await community(owner, 'Target Hall');
    // A second founder: one person may start two communities a day.
    const founder = await member('xp-founder');
    const made = await createCommunity(
      founder,
      'aaa',
      { name: 'Closed Origin', visibility: 'restricted' },
      settings,
    );
    if (!made.ok) throw new Error(made.error);
    const closed = made.value;
    await joinCommunity(m, 'aaa', home.id, settings);
    await joinCommunity(m, 'aaa', target.id, settings);
    const original = await createPost(
      owner,
      'aaa',
      home.id,
      { kind: 'text', title: 'Read this everywhere', body: 'x' },
      settings,
    );
    if (!original.ok) throw new Error(original.error);
    const secret = await createPost(
      founder,
      'aaa',
      closed.id,
      { kind: 'text', title: 'Members only', body: '' },
      settings,
    );
    if (!secret.ok) throw new Error(secret.error);

    expect(await crosspost(m, 'aaa', original.value.id, home.id, settings)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await crosspost(m, 'aaa', secret.value.id, target.id, settings)).toEqual({
      ok: false,
      error: 'not_found',
    });
    const stranger = await member('xp-stranger');
    expect(await crosspost(stranger, 'aaa', original.value.id, target.id, settings)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    const made2 = await crosspost(m, 'aaa', original.value.id, target.id, settings);
    if (!made2.ok) throw new Error(made2.error);
    expect(await crosspost(m, 'aaa', original.value.id, target.id, settings)).toEqual({
      ok: false,
      error: 'exists',
    });

    const view = await postById(null, 'aaa', made2.value.id);
    expect(view).toMatchObject({
      title: 'Read this everywhere',
      communityId: target.id,
      crosspostOf: original.value.id,
      crosspost: {
        postId: original.value.id,
        title: 'Read this everywhere',
        communitySlug: home.slug,
        communityName: 'Origin Hall',
      },
    });
    const feed = await listCommunityPosts(null, 'aaa', target.id);
    expect(feed.items[0]?.crosspost?.communitySlug).toBe(home.slug);
    // Crossposting a crosspost points at the original; the removed original leaves the pointer bare.
    const third = await community(founder, 'Third Hall');
    await joinCommunity(m, 'aaa', third.id, settings);
    const again = await crosspost(m, 'aaa', made2.value.id, third.id, settings);
    expect(again.ok && (await postById(null, 'aaa', again.value.id))?.crosspostOf).toBe(
      original.value.id,
    );
    expect((await removeItem(owner, 'aaa', 'post', original.value.id, { reason: 'Gone' })).ok).toBe(
      true,
    );
    expect((await postById(null, 'aaa', made2.value.id))?.crosspost).toBeNull();
  });
});

describe('profiles and private lists', () => {
  it('shows a person by handle with only what they signed, a karma sum, and their own private lists', async () => {
    const owner = await member('pr-owner');
    const author = await member('pr-author');
    const fan = await member('pr-fan');
    const c = await community(owner, 'Profile Hall');
    await joinCommunity(author, 'aaa', c.id, settings);
    await joinCommunity(fan, 'aaa', c.id, settings);
    const me = await profileByHandle('aaa', 'nobody-like-this');
    expect(me).toBeNull();
    const signed = await createPost(
      author,
      'aaa',
      c.id,
      { kind: 'text', title: 'Signed words', body: '' },
      settings,
    );
    const anon = await createPost(
      author,
      'aaa',
      c.id,
      { kind: 'text', title: 'Unsigned words', body: '', isAnonymous: true },
      settings,
    );
    if (!signed.ok || !anon.ok) throw new Error('setup');
    const cm = await createComment(
      author,
      'aaa',
      signed.value.id,
      null,
      { body: 'a signed comment' },
      settings,
    );
    const anonCm = await createComment(
      author,
      'aaa',
      signed.value.id,
      null,
      { body: 'an unsigned comment', isAnonymous: true },
      settings,
    );
    if (!cm.ok || !anonCm.ok) throw new Error('setup');
    await votePost(fan, 'aaa', signed.value.id, 1);
    await votePost(fan, 'aaa', anon.value.id, 1);
    await voteComment(fan, 'aaa', cm.value.id, 1);

    // The handle resolves whatever the case; the profile carries nothing anonymous.
    const handle = (await postById(null, 'aaa', signed.value.id))!.author!.handle;
    const profile = await profileByHandle('aaa', handle.toUpperCase());
    expect(profile).toMatchObject({ userId: author.userId, handle });
    expect((await postsByAuthor('aaa', author.userId)).map((p) => p.title)).toEqual([
      'Signed words',
    ]);
    expect((await commentsByAuthor('aaa', author.userId)).map((x) => x.body)).toEqual([
      'a signed comment',
    ]);
    // The public number counts the signed post and comment and not the
    // anonymous post, which is the whole reason there are two.
    expect(await publicKarma('aaa', author.userId)).toEqual({ posts: 1, comments: 1, total: 2 });
    // Their own number counts the anonymous post too, and nobody else can ask
    // for it: `ownKarma` reads the caller's row and the policy allows no other.
    expect(await ownKarma(author, 'aaa')).toEqual({
      posts: 2,
      comments: 1,
      total: 3,
      publicPosts: 1,
      publicComments: 1,
      publicTotal: 2,
    });
    expect(await ownKarma(fan, 'aaa')).toMatchObject({ total: 0 });
    // The private anonymous list is the author's alone.
    expect((await myAnonymousPosts(author, 'aaa')).map((p) => p.title)).toEqual(['Unsigned words']);
    expect(await myAnonymousPosts(fan, 'aaa')).toEqual([]);

    // Blocking shows on the profile for the blocker only.
    expect(await isBlocked(fan, 'aaa', author.userId)).toBe(false);
    await blockUser(fan, 'aaa', author.userId);
    expect(await isBlocked(fan, 'aaa', author.userId)).toBe(true);
    expect(await isBlocked(owner, 'aaa', author.userId)).toBe(false);

    // Saved comments and hidden posts are the person's own lists; unhide brings a post back.
    await saveItem(fan, 'aaa', 'comment', cm.value.id, true);
    expect((await listSavedComments(fan, 'aaa')).map((x) => [x.body, x.postTitle])).toEqual([
      ['a signed comment', 'Signed words'],
    ]);
    expect(await listSavedComments(owner, 'aaa')).toEqual([]);
    // The owner, who blocked nobody, so hiding alone decides what their feed shows.
    await hideItem(owner, 'aaa', 'post', signed.value.id, true);
    expect((await listHiddenPosts(owner, 'aaa')).map((p) => p.id)).toEqual([signed.value.id]);
    expect((await listCommunityPosts(owner, 'aaa', c.id)).items.map((p) => p.id)).not.toContain(
      signed.value.id,
    );
    await hideItem(owner, 'aaa', 'post', signed.value.id, false);
    expect(await listHiddenPosts(owner, 'aaa')).toEqual([]);
    expect((await listCommunityPosts(owner, 'aaa', c.id)).items.map((p) => p.id)).toContain(
      signed.value.id,
    );
  });
});

describe('polish: rules acceptance, archive, held across the tenant', () => {
  it('asks a member to accept the rules before a first post, once, and never a manager', async () => {
    const owner = await member('ra-owner');
    const m = await member('ra-member');
    const c = await community(owner, 'Rules Hall');
    await joinCommunity(m, 'aaa', c.id, settings);
    // No rules: nothing to accept.
    expect(await needsRulesAcceptance(m, 'aaa', c.id)).toBe(false);
    expect(
      (
        await createPost(
          m,
          'aaa',
          c.id,
          { kind: 'text', title: 'Before rules', body: '' },
          settings,
        )
      ).ok,
    ).toBe(true);
    const set = await setRules(owner, 'aaa', c.id, [{ title: 'Be kind', description: '' }]);
    expect(set.ok).toBe(true);
    expect(await needsRulesAcceptance(m, 'aaa', c.id)).toBe(true);
    expect(await needsRulesAcceptance(owner, 'aaa', c.id)).toBe(false);
    expect(
      await createPost(m, 'aaa', c.id, { kind: 'text', title: 'Too soon', body: '' }, settings),
    ).toEqual({ ok: false, error: 'rules_not_accepted' });
    expect(
      (
        await createPost(
          owner,
          'aaa',
          c.id,
          { kind: 'text', title: 'Owner posts', body: '' },
          settings,
        )
      ).ok,
    ).toBe(true);
    // A stranger has no membership to mark.
    const outsider = await member('ra-outsider');
    expect(await acceptRules(outsider, 'aaa', c.id)).toEqual({ ok: false, error: 'not_allowed' });
    expect(await acceptRules(m, 'aaa', c.id)).toEqual({ ok: true, value: { accepted: true } });
    expect(await acceptRules(m, 'aaa', c.id)).toEqual({ ok: true, value: { accepted: true } });
    expect(await needsRulesAcceptance(m, 'aaa', c.id)).toBe(false);
    expect(
      (await createPost(m, 'aaa', c.id, { kind: 'text', title: 'After rules', body: '' }, settings))
        .ok,
    ).toBe(true);
  });

  it('archives by the tenant only, refuses posts while archived, and reopens; the sweep leaves live communities alone', async () => {
    const owner = await member('ar-owner');
    const overseer = await admin('ar-admin');
    const c = await community(owner, 'Old Hall');
    expect(await setArchived(owner, 'aaa', c.id, true)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(await setArchived(overseer, 'aaa', c.id, true)).toEqual({
      ok: true,
      value: { archived: true },
    });
    expect(
      await createPost(owner, 'aaa', c.id, { kind: 'text', title: 'Anyone?', body: '' }, settings),
    ).toEqual({ ok: false, error: 'archived' });
    const listed = await listCommunitiesForOversight(overseer, 'aaa');
    expect(listed.ok && listed.value.find((x) => x.id === c.id)?.archivedAt).toBeInstanceOf(Date);
    expect(await setArchived(overseer, 'aaa', c.id, false)).toEqual({
      ok: true,
      value: { archived: false },
    });
    expect(
      (await createPost(owner, 'aaa', c.id, { kind: 'text', title: 'Back', body: '' }, settings))
        .ok,
    ).toBe(true);
    // Everything here is newer than any window, so the sweep archives nothing.
    expect(await archiveIdle('aaa', 1)).toEqual({ archived: [] });
    expect(
      await setArchived(overseer, 'aaa', '00000000-0000-0000-0000-000000000000', true),
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('lists held items across the tenant for oversight only', async () => {
    const overseer = await admin('hd-admin');
    const o1 = await member('hd-o1');
    const o2 = await member('hd-o2');
    const c1 = await community(o1, 'Held One');
    const c2 = await community(o2, 'Held Two');
    for (const [who, c] of [
      [o1, c1],
      [o2, c2],
    ] as const) {
      const set = await setAutomodRules(who, 'aaa', c.id, [
        { kind: 'keyword', pattern: 'lottery', action: 'queue' },
      ]);
      expect(set.ok).toBe(true);
      const held = await createPost(
        who,
        'aaa',
        c.id,
        { kind: 'text', title: 'Free lottery tickets', body: '' },
        settings,
      );
      expect(held.ok && held.value.held).toBe(true);
    }
    expect(await listHeld(o1, 'aaa', null)).toEqual({ ok: false, error: 'not_allowed' });
    const mine = await listHeld(o1, 'aaa', c1.id);
    expect(mine.ok && mine.value.map((h) => h.communityId)).toEqual([c1.id]);
    const all = await listHeld(overseer, 'aaa', null);
    expect(all.ok && all.value.map((h) => h.communityId).sort()).toEqual([c1.id, c2.id].sort());
  });
});

describe('karma: what other people did', () => {
  it('counts votes received, refuses an author their own, and keeps the anonymous half private', async () => {
    const owner = await member('k-owner');
    const author = await member('k-author');
    const fan = await member('k-fan');
    const c = await community(owner, 'Karma');
    await joinCommunity(author, 'aaa', c.id, settings);
    await joinCommunity(fan, 'aaa', c.id, settings);
    const post = await createPost(
      author,
      'aaa',
      c.id,
      { kind: 'text', title: 'A post', body: '' },
      settings,
    );
    if (!post.ok) throw new Error(post.error);
    const comment = await createComment(
      author,
      'aaa',
      post.value.id,
      null,
      { body: 'and a comment' },
      settings,
    );
    if (!comment.ok) throw new Error('setup');

    // Nothing accrues for writing it. Karma is what other people did.
    expect(await publicKarma('aaa', author.userId)).toEqual({ posts: 0, comments: 0, total: 0 });

    // An author's own vote is refused rather than counted and then subtracted,
    // so the tally on the item and the karma agree about what happened.
    expect(await votePost(author, 'aaa', post.value.id, 1)).toEqual({
      ok: false,
      error: 'self_vote',
    });
    expect(await voteComment(author, 'aaa', comment.value.id, 1)).toEqual({
      ok: false,
      error: 'self_vote',
    });
    expect((await postById(null, 'aaa', post.value.id))!.score).toBe(0);
    expect(await publicKarma('aaa', author.userId)).toEqual({ posts: 0, comments: 0, total: 0 });

    await votePost(fan, 'aaa', post.value.id, 1);
    await voteComment(fan, 'aaa', comment.value.id, 1);
    expect(await publicKarma('aaa', author.userId)).toEqual({ posts: 1, comments: 1, total: 2 });

    // A downvote takes it away again, and clearing the vote puts it back: the
    // ledger holds the net, so the same voter cannot pump by toggling.
    await votePost(fan, 'aaa', post.value.id, -1);
    expect(await publicKarma('aaa', author.userId)).toMatchObject({ posts: -1, total: 0 });
    await votePost(fan, 'aaa', post.value.id, 0);
    expect(await publicKarma('aaa', author.userId)).toMatchObject({ posts: 0, total: 1 });
    await votePost(fan, 'aaa', post.value.id, 1);
    expect(await publicKarma('aaa', author.userId)).toMatchObject({ posts: 1, total: 2 });

    // An anonymous item is the author's, and stays out of the public number.
    const anon = await createPost(
      author,
      'aaa',
      c.id,
      { kind: 'text', title: 'Unsigned', body: '', isAnonymous: true },
      settings,
    );
    if (!anon.ok) throw new Error('setup');
    await votePost(fan, 'aaa', anon.value.id, 1);
    expect(await publicKarma('aaa', author.userId)).toEqual({ posts: 1, comments: 1, total: 2 });
    expect(await ownKarma(author, 'aaa')).toMatchObject({ posts: 2, total: 3, publicTotal: 2 });

    // The ledger names a voter and an author side by side, so the application
    // may not read it at all: seeing one row would name an anonymous author.
    const ledger = await withActorInTenant(fan.userId, 'aaa', (tx) =>
      tx.execute(sql`select count(*)::int as n from karma_ledger`),
    );
    // One row, not three: the cap is per voter per author per day, and all
    // three votes were one person's, on one person's items, on one day.
    expect(([...ledger] as { n: number }[])[0]!.n).toBe(split ? 0 : 1);

    // And it is per tenant: the same person starts at nothing next door.
    await member('k-author', 'bbb');
    expect(await publicKarma('bbb', author.userId)).toEqual({ posts: 0, comments: 0, total: 0 });
  });

  it('caps how far one account can move another in a day, and rebuilds the same total', async () => {
    // Two is enough to show the shape, and keeps the fixture inside the
    // per-hour comment limit. The default is ten.
    await runAsMigrationRole(
      `insert into tenant_configs (slug, config) values ('aaa', '{"moduleSettings":{"communities":{"karmaVotePerDayCap":2}}}'::jsonb)
       on conflict (slug) do update set config = excluded.config`,
    );
    const owner = await member('cap-owner');
    const author = await member('cap-author');
    const fan = await member('cap-fan');
    const other = await member('cap-other');
    const c = await community(owner, 'Capped');
    for (const who of [author, fan, other]) await joinCommunity(who, 'aaa', c.id, settings);
    const post = await createPost(
      author,
      'aaa',
      c.id,
      { kind: 'text', title: 'Thread', body: '' },
      settings,
    );
    if (!post.ok) throw new Error(post.error);
    const ids: string[] = [];
    for (const body of ['one', 'two', 'three', 'four']) {
      const made = await createComment(author, 'aaa', post.value.id, null, { body }, settings);
      if (!made.ok) throw new Error('setup');
      ids.push(made.value.id);
    }

    for (const id of ids) await voteComment(fan, 'aaa', id, 1);
    // Four upvotes from one account, two of them counted. The votes themselves
    // all landed: the cap is on the karma, not on being allowed to vote.
    expect(await publicKarma('aaa', author.userId)).toMatchObject({ comments: 2, total: 2 });
    expect((await commentsByAuthor('aaa', author.userId)).every((x) => x.score === 1)).toBe(true);

    // A second account has its own budget, so a real thread still adds up.
    for (const id of ids) await voteComment(other, 'aaa', id, 1);
    expect(await publicKarma('aaa', author.userId)).toMatchObject({ comments: 4, total: 4 });

    // The table is a cache of a derivation, and this is the derivation.
    const before = await publicKarma('aaa', author.userId);
    await runAsMigrationRole(`delete from community_karma where tenant_id = 'aaa'`);
    expect(await publicKarma('aaa', author.userId)).toEqual({ posts: 0, comments: 0, total: 0 });
    // Eight votes replayed, four of them counted: the cap applies on the way
    // back in exactly as it did the first time.
    expect(await recomputeKarma('aaa')).toBe(4);
    expect(await publicKarma('aaa', author.userId)).toEqual(before);
  });

  it('answers for several people in one query, and zero for someone nobody voted on', async () => {
    const owner = await member('many-owner');
    const author = await member('many-author');
    const quiet = await member('many-quiet');
    const fan = await member('many-fan');
    const c = await community(owner, 'Many');
    await joinCommunity(author, 'aaa', c.id, settings);
    await joinCommunity(fan, 'aaa', c.id, settings);
    const post = await createPost(
      author,
      'aaa',
      c.id,
      { kind: 'text', title: 'Hello', body: '' },
      settings,
    );
    if (!post.ok) throw new Error(post.error);
    await votePost(fan, 'aaa', post.value.id, 1);
    const found = await publicKarmaFor('aaa', [author.userId, quiet.userId, quiet.userId]);
    expect(found.get(author.userId)).toEqual({ posts: 1, comments: 0, total: 1 });
    // Nobody has voted on them, so there is no row and the page shows nothing
    // rather than waiting for one.
    expect(found.get(quiet.userId)).toBeUndefined();
    expect(await publicKarma('aaa', quiet.userId)).toEqual({ posts: 0, comments: 0, total: 0 });
    expect(await publicKarmaFor('aaa', [])).toEqual(new Map());
  });
});

describe('participation gates', () => {
  /** A community with gates set, since only a moderator may set them. */
  async function gated(
    owner: { userId: string },
    name: string,
    gates: Partial<{
      minKarmaToPost: number;
      minKarmaToComment: number;
      minKarmaToJoin: number;
      minAccountAgeDays: number;
    }>,
  ) {
    const c = await community(owner, name);
    const saved = await updateCommunitySettings(owner, 'aaa', c.id, {
      name: c.name,
      description: '',
      allowAnonymous: true,
      visibility: 'public',
      allowedKinds: ['text', 'link', 'poll'],
      modLogPublic: false,
      minKarmaToPost: 0,
      minKarmaToComment: 0,
      minKarmaToJoin: 0,
      minAccountAgeDays: 0,
      requireVerified: true,
      ...gates,
    });
    if (!saved.ok) throw new Error(saved.error);
    return saved.value;
  }

  it('takes the greater of what the community asks and what the university requires', () => {
    const community = {
      minKarmaToPost: 5,
      minKarmaToComment: 0,
      minKarmaToJoin: 0,
      minAccountAgeDays: 2,
      requireVerified: false,
    };
    const floor = { floorMinKarma: 10, floorAccountAgeDays: 0, floorRequireVerified: true };
    // The community asks five and the university ten, so ten. Setting a gate to
    // zero does not drop below the floor, which is the point of having one.
    expect(effectiveGates(community, floor, 'post')).toEqual({
      minKarma: 10,
      minAccountAgeDays: 2,
      requireVerified: true,
    });
    expect(effectiveGates(community, floor, 'comment')).toMatchObject({ minKarma: 10 });
    // And a community may ask for more than the floor.
    expect(effectiveGates(community, { ...floor, floorMinKarma: 1 }, 'post').minKarma).toBe(5);
    // requireVerified can only ever go on, never off.
    expect(
      effectiveGates(community, { ...floor, floorRequireVerified: false }, 'post').requireVerified,
    ).toBe(false);
    expect(
      effectiveGates(
        { ...community, requireVerified: true },
        { ...floor, floorRequireVerified: false },
        'post',
      ).requireVerified,
    ).toBe(true);
  });

  it('blocks a post and a comment below the karma the community asks for, then admits them', async () => {
    const owner = await member('g-owner');
    const writer = await member('g-writer');
    const fan = await member('g-fan');
    const c = await gated(owner, 'Karma Gate', { minKarmaToPost: 2, minKarmaToComment: 1 });
    await joinCommunity(writer, 'aaa', c.id, settings);
    await joinCommunity(fan, 'aaa', c.id, settings);

    expect(
      await createPost(
        writer,
        'aaa',
        c.id,
        { kind: 'text', title: 'Too soon', body: '' },
        settings,
      ),
    ).toEqual({ ok: false, error: 'gate_karma' });
    // The refusal knows the numbers, which is what the message is made of.
    expect(await describeGate(writer, 'aaa', c.id, 'post', settings, 'gate_karma')).toEqual({
      need: 2,
      have: 0,
    });

    // Somewhere else, they earn some. Karma is per tenant, not per community,
    // so a gate here is answered by anything they wrote anywhere in the tenant.
    const open = await community(owner, 'Open Hall');
    await joinCommunity(writer, 'aaa', open.id, settings);
    await joinCommunity(fan, 'aaa', open.id, settings);
    const first = await createPost(
      writer,
      'aaa',
      open.id,
      { kind: 'text', title: 'Elsewhere', body: '' },
      settings,
    );
    if (!first.ok) throw new Error(first.error);
    await votePost(fan, 'aaa', first.value.id, 1);

    // One karma is enough to comment here and not yet enough to post.
    const host = await createPost(
      owner,
      'aaa',
      c.id,
      { kind: 'text', title: 'A thread', body: '' },
      settings,
    );
    if (!host.ok) throw new Error(host.error);
    expect(
      (await createComment(writer, 'aaa', host.value.id, null, { body: 'hello' }, settings)).ok,
    ).toBe(true);
    // The owner set the gate and is not who it is for: they can still write in
    // their own community without lowering it first.
    expect(await publicKarma('aaa', owner.userId)).toMatchObject({ total: 0 });
    expect(
      await createPost(writer, 'aaa', c.id, { kind: 'text', title: 'Still', body: '' }, settings),
    ).toEqual({ ok: false, error: 'gate_karma' });

    const second = await createComment(
      writer,
      'aaa',
      host.value.id,
      null,
      { body: 'again' },
      settings,
    );
    if (!second.ok) throw new Error(second.error);
    await voteComment(fan, 'aaa', second.value.id, 1);
    expect(await publicKarma('aaa', writer.userId)).toMatchObject({ total: 2 });
    expect(
      (await createPost(writer, 'aaa', c.id, { kind: 'text', title: 'Now', body: '' }, settings))
        .ok,
    ).toBe(true);
  });

  it('blocks an account younger than the community asks for, and joining as well as writing', async () => {
    const owner = await member('age-owner');
    const young = await member('age-young');
    const c = await gated(owner, 'Age Gate', { minAccountAgeDays: 3, minKarmaToJoin: 1 });

    // Joining is gated too, and karma is checked before age so the thing they
    // cannot fix by waiting is the thing they are told about first.
    expect(await joinCommunity(young, 'aaa', c.id, settings)).toEqual({
      ok: false,
      error: 'gate_karma',
    });
    expect(await describeGate(young, 'aaa', c.id, 'join', settings, 'gate_karma')).toEqual({
      need: 1,
      have: 0,
    });

    // With the karma gate out of the way, the account age is what remains.
    const open = await gated(owner, 'Age Open', { minAccountAgeDays: 3 });
    expect(await joinCommunity(young, 'aaa', open.id, settings)).toEqual({
      ok: false,
      error: 'gate_account_age',
    });
    expect(await describeGate(young, 'aaa', open.id, 'join', settings, 'gate_account_age')).toEqual(
      { need: 3, have: 0 },
    );

    // Age the account by four days and the same person is admitted.
    await runAsMigrationRole(
      `update users set created_at = now() - interval '4 days' where id = '${young.userId}'`,
    );
    expect(await joinCommunity(young, 'aaa', open.id, settings)).toEqual({
      ok: true,
      value: { joined: true },
    });
  });

  it('applies the tenant floor to a community that asks for nothing', async () => {
    const owner = await member('floor-owner');
    const writer = await member('floor-writer');
    const c = await community(owner, 'Ungated');
    await joinCommunity(writer, 'aaa', c.id, settings);
    // Nothing set here, so today anyone may write.
    expect(
      (await createPost(writer, 'aaa', c.id, { kind: 'text', title: 'Fine', body: '' }, settings))
        .ok,
    ).toBe(true);

    // The university raises its floor, and the same community is now gated
    // without anybody editing it: the floor is applied where the check runs.
    const strict = { ...settings, floorMinKarma: 3 };
    expect(
      await createPost(writer, 'aaa', c.id, { kind: 'text', title: 'Not now', body: '' }, strict),
    ).toEqual({ ok: false, error: 'gate_karma' });
    expect(await describeGate(writer, 'aaa', c.id, 'post', strict, 'gate_karma')).toEqual({
      need: 3,
      have: 0,
    });
  });
});

describe('reporting a person', () => {
  it('files against the tenant, not a community, and never hides anybody', async () => {
    const owner = await member('rp-owner');
    const target = await member('rp-target');
    const one = await member('rp-one');
    const two = await member('rp-two');
    const three = await member('rp-three');
    const admin1 = await admin('rp-admin');
    const c = await community(owner, 'Reports');
    await joinCommunity(target, 'aaa', c.id, settings);
    const post = await createPost(
      target,
      'aaa',
      c.id,
      { kind: 'text', title: 'Still here', body: '' },
      settings,
    );
    if (!post.ok) throw new Error(post.error);

    // Their own account is not reportable, and neither is one nobody here has.
    expect(
      await reportItem(target, 'aaa', {
        itemType: 'user',
        itemId: target.userId,
        reason: 'harassment',
      }),
    ).toEqual({ ok: false, error: 'self' });
    expect(
      await reportItem(one, 'aaa', {
        itemType: 'user',
        itemId: '00000000-0000-0000-0000-000000000000',
        reason: 'harassment',
      }),
    ).toEqual({ ok: false, error: 'not_found' });

    // One report each, and never twice from the same person.
    const first = await reportItem(one, 'aaa', {
      itemType: 'user',
      itemId: target.userId,
      reason: 'harassment',
      note: 'Followed me across three threads.',
    });
    expect(first).toMatchObject({ ok: true, value: { hidden: false } });
    expect(
      await reportItem(one, 'aaa', {
        itemType: 'user',
        itemId: target.userId,
        reason: 'spam',
      }),
    ).toEqual({ ok: false, error: 'exists' });

    // Reports about a person never hide anything: hiding is what happens to a
    // post, and what happens to a person is a decision somebody signs.
    for (const who of [two, three]) {
      expect(
        (
          await reportItem(who, 'aaa', {
            itemType: 'user',
            itemId: target.userId,
            reason: 'threats',
          })
        ).ok,
      ).toBe(true);
    }
    expect((await postById(null, 'aaa', post.value.id))!.removedAt).toBeNull();
    expect(await standingFor(target.userId, 'aaa')).toMatchObject({ status: 'active' });

    // The queue is the university's, and it is behind restrict-members.
    expect(await listReportedPeople(one, 'aaa')).toEqual({ ok: false, error: 'not_allowed' });
    const queue = await listReportedPeople(admin1, 'aaa', 3);
    expect(queue.ok && queue.value).toHaveLength(1);
    expect(queue.ok && queue.value[0]).toMatchObject({
      userId: target.userId,
      openReports: 3,
      flagged: true,
    });
    expect(queue.ok && queue.value[0]!.reasons.sort()).toEqual(['harassment', 'threats']);
    // Below the threshold it is listed and not flagged: repeated reports raise
    // the flag and nothing else does.
    const lenient = await listReportedPeople(admin1, 'aaa', 10);
    expect(lenient.ok && lenient.value[0]).toMatchObject({ openReports: 3, flagged: false });

    // Closing them empties the queue and leaves the person exactly as they were.
    expect(await resolveUserReports(one, 'aaa', target.userId, 'dismissed')).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(await resolveUserReports(admin1, 'aaa', target.userId, 'dismissed')).toEqual({
      ok: true,
      value: { closed: 3 },
    });
    expect(await resolveUserReports(admin1, 'aaa', target.userId, 'dismissed')).toEqual({
      ok: false,
      error: 'not_found',
    });
    const after = await listReportedPeople(admin1, 'aaa');
    expect(after.ok && after.value).toEqual([]);
    expect(await standingFor(target.userId, 'aaa')).toMatchObject({ status: 'active' });

    // And it is written down: closing a queue is an act, so it is audited.
    const log = await withTenant('aaa', (tx) =>
      tx.execute(
        sql`select action, target_id from audit_log
            where tenant_id = 'aaa' and action = 'reports.person_resolved'`,
      ),
    );
    expect([...log]).toHaveLength(1);

    // A report about a post still behaves as it always did.
    const onPost = await reportItem(
      one,
      'aaa',
      { itemType: 'post', itemId: post.value.id, reason: 'spam' },
      settings,
    );
    expect(onPost).toMatchObject({ ok: true, value: { hidden: false } });
    const stillPeople = await listReportedPeople(admin1, 'aaa');
    expect(stillPeople.ok && stillPeople.value).toEqual([]);
  });
});

describe('standing reaches every write', () => {
  it('lets a restricted member read and refuses everything they would write', async () => {
    const a = await admin('st-admin');
    const owner = await member('st-owner');
    const target = await member('st-target');
    const c = await community(owner, 'Standing');
    await joinCommunity(target, 'aaa', c.id, settings);
    const host = await createPost(
      owner,
      'aaa',
      c.id,
      { kind: 'text', title: 'A thread', body: '' },
      settings,
    );
    if (!host.ok) throw new Error(host.error);
    const mine = await createPost(
      target,
      'aaa',
      c.id,
      { kind: 'text', title: 'Mine', body: '' },
      settings,
    );
    if (!mine.ok) throw new Error(mine.error);

    expect(
      await setStanding(a, 'aaa', target.userId, { status: 'restricted', reason: 'Cooling off' }),
    ).toMatchObject({ ok: true });

    // Read-only in the tenant: they can still see everything they could see.
    expect((await postById(target, 'aaa', host.value.id))!.title).toBe('A thread');
    expect((await listCommunityPosts(target, 'aaa', c.id)).items.length).toBeGreaterThan(0);

    // And write nothing at all. The refusal is `not_verified` because standing
    // and verification meet at the same check: `auth_effective_permissions`
    // returns nothing for a membership that is not active, so the database is
    // what refuses them rather than a branch in this module.
    const refused = { ok: false, error: 'not_verified' };
    expect(
      await createPost(target, 'aaa', c.id, { kind: 'text', title: 'No', body: '' }, settings),
    ).toEqual(refused);
    expect(
      await createComment(target, 'aaa', host.value.id, null, { body: 'no' }, settings),
    ).toEqual(refused);
    expect(await votePost(target, 'aaa', host.value.id, 1)).toEqual(refused);
    expect(
      await reportItem(target, 'aaa', {
        itemType: 'post',
        itemId: host.value.id,
        reason: 'spam',
      }),
    ).toEqual(refused);
    expect(await createCommunity(target, 'aaa', { name: 'Not Now' }, settings)).toEqual(refused);
    expect(await joinCommunity(target, 'aaa', c.id, settings)).toEqual(refused);
    // Their own post is still theirs and still there; a restriction is not a
    // deletion, and nothing of theirs was touched.
    expect((await postById(null, 'aaa', mine.value.id))!.removedAt).toBeNull();

    // Lifting it gives everything back.
    expect(await liftStanding(a, 'aaa', target.userId)).toMatchObject({ ok: true });
    expect(
      (await createPost(target, 'aaa', c.id, { kind: 'text', title: 'Back', body: '' }, settings))
        .ok,
    ).toBe(true);
  });

  it('refuses a suspended member every write too, and holds until it lapses', async () => {
    const a = await admin('sp-admin');
    const owner = await member('sp-owner');
    const target = await member('sp-target');
    const c = await community(owner, 'Suspended');
    await joinCommunity(target, 'aaa', c.id, settings);

    expect(
      await setStanding(a, 'aaa', target.userId, {
        status: 'suspended',
        reason: 'Repeated abuse',
        minutes: 60,
      }),
    ).toMatchObject({ ok: true });
    // A suspension is not enforced at sign in: an account spans universities,
    // and the same person may be in good standing at another. It is enforced
    // where this university's pages are, and here, where its writes are.
    expect(
      await createPost(target, 'aaa', c.id, { kind: 'text', title: 'No', body: '' }, settings),
    ).toEqual({ ok: false, error: 'not_verified' });

    // An expiry in the past is no longer a standing, and nothing has to run.
    await runAsMigrationRole(
      `update tenant_memberships set standing_until = now() - interval '1 minute'
       where tenant_id = 'aaa' and user_id = '${target.userId}'`,
    );
    expect(await standingFor(target.userId, 'aaa')).toMatchObject({ status: 'active' });
    expect(
      (await createPost(target, 'aaa', c.id, { kind: 'text', title: 'Back', body: '' }, settings))
        .ok,
    ).toBe(true);
  });
});

describe('definer grant hygiene', () => {
  // Every function the owner creates inherits EXECUTE for campusos_app from the
  // default privileges (db-grants), so an owner-only SECURITY DEFINER that does
  // not REVOKE from the app BY NAME silently stays callable by a request — the
  // trap that bit communities_karma_recompute (PR #113) and, in review,
  // auth_attach_role_internal (0019). Pinning the two known offenders is not
  // enough: the IDIOM is the hazard. This asserts every definer's actual EXECUTE
  // grant matches its DECLARED intent, so a new owner-only definer that inherits
  // the grant, or a new app definer nobody granted, fails CI by construction.
  //
  // Intent is declared here on purpose: a new definer forces a deliberate choice
  // (the test fails until it is listed), and 'owner' entries must be revoked from
  // the app by name in their migration or the actual grant will not match.
  const DEFINER_INTENT: Record<string, 'app' | 'owner'> = {
    // App-callable: the application invokes these directly, or a RLS policy does
    // (auth_under_tenant_grant / auth_grant_admin_for_txn run during the app's
    // own queries), and each does its own checks inside.
    auth_appeal_standing: 'app',
    auth_assume_tenant_grant: 'app',
    auth_effective_community_permissions: 'app',
    auth_effective_permissions: 'app',
    auth_grant_admin_for_txn: 'app',
    auth_grant_platform_admin: 'app',
    auth_handle_is_reserved: 'app',
    auth_join_as_student: 'app',
    auth_open_tenant_grant: 'app',
    auth_resolve_session: 'app',
    auth_resolve_user_by_subject: 'app',
    auth_revoke_grants_for_session: 'app',
    auth_revoke_tenant_grant: 'app',
    auth_set_join_policy: 'app',
    auth_set_membership_role: 'app',
    auth_sync_tenant_roles: 'app',
    auth_tenant_activity_days: 'app',
    auth_tenant_activity_totals: 'app',
    auth_tenant_grants_for_tenant: 'app',
    auth_tenant_member_activity: 'app',
    auth_under_tenant_grant: 'app',
    auth_verify_member: 'app',
    auth_verify_self_by_domain: 'app',
    auth_write_standing: 'app',
    communities_karma_vote: 'app',
    communities_notify: 'app',
    communities_unmask: 'app',
    // Owner-only: a maintenance script, an internal helper of other definers, or
    // a trigger function. The application must NOT be able to call these; each is
    // revoked from campusos_app BY NAME in its migration.
    auth_attach_role_internal: 'owner',
    auth_migrate_configured_admin: 'owner',
    audit_log_stamp_grant: 'owner',
    communities_karma_recompute: 'owner',
  };

  it('grants each definer EXECUTE to the app exactly as its declared intent says', async (ctx) => {
    if (!split) return ctx.skip();
    const rows = [
      ...(await getDb().execute(
        sql`select p.proname,
                   has_function_privilege('campusos_app', p.oid, 'execute') as app_can_execute
            from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef`,
      )),
    ] as { proname: string; app_can_execute: boolean }[];

    // No definer may exist without a declared intent: a new one forces a choice.
    const undeclared = rows.map((r) => r.proname).filter((n) => !(n in DEFINER_INTENT));
    expect(
      undeclared,
      'undeclared SECURITY DEFINER functions — add them to DEFINER_INTENT',
    ).toEqual([]);

    // And the actual grant must match the declared intent, both directions: an
    // owner-only definer must not be app-executable, an app one must be.
    const mismatches = rows
      .filter((r) => r.proname in DEFINER_INTENT)
      .filter((r) => r.app_can_execute !== (DEFINER_INTENT[r.proname] === 'app'))
      .map(
        (r) =>
          `${r.proname}: intent=${DEFINER_INTENT[r.proname]} but app_can_execute=${r.app_can_execute}`,
      );
    expect(mismatches, 'a definer whose EXECUTE grant does not match its intent').toEqual([]);

    // Guard against the map rotting: every declared name must exist.
    const present = new Set(rows.map((r) => r.proname));
    const stale = Object.keys(DEFINER_INTENT).filter((n) => !present.has(n));
    expect(stale, 'DEFINER_INTENT names that no longer exist').toEqual([]);
  });

  it('db-grants re-applied after migrate never re-opens an owner-only definer', async (ctx) => {
    if (!split) return ctx.skip();
    // db-grants.sql bills itself re-runnable and the production role-split runbook
    // re-applies it after migrating. Its function-grant loop must exclude SECURITY
    // DEFINER functions; a blanket `GRANT EXECUTE ON ALL FUNCTIONS ... TO
    // campusos_app` would re-grant the owner-only definers by name and re-open the
    // hole (communities 0011). Run the real file's loop against this
    // already-migrated database, as the owner, and prove every definer's app
    // EXECUTE still matches its declared intent.
    const grants = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '..',
        'scripts',
        'db-grants.sql',
      ),
      'utf8',
    );
    // Check the SQL, not the comments (which name the anti-pattern to explain it).
    const sqlOnly = grants.replace(/--.*$/gm, '');
    expect(
      sqlOnly,
      'db-grants must not blanket-grant EXECUTE on all functions to the app',
    ).not.toMatch(/grant\s+execute\s+on\s+all\s+functions[^;]*campusos_app/i);
    const loop = sqlOnly.match(/DO \$\$[\s\S]*?\$\$;/);
    expect(
      loop,
      'db-grants must grant function EXECUTE via a definer-excluding loop',
    ).not.toBeNull();

    await runAsMigrationRole(loop![0]);

    const rows = [
      ...(await getDb().execute(
        sql`select p.proname,
                   has_function_privilege('campusos_app', p.oid, 'execute') as app_can_execute
            from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef`,
      )),
    ] as { proname: string; app_can_execute: boolean }[];
    const mismatches = rows
      .filter((r) => r.proname in DEFINER_INTENT)
      .filter((r) => r.app_can_execute !== (DEFINER_INTENT[r.proname] === 'app'))
      .map(
        (r) =>
          `${r.proname}: intent=${DEFINER_INTENT[r.proname]} but app_can_execute=${r.app_can_execute}`,
      );
    expect(mismatches, 're-applying db-grants changed a definer EXECUTE grant').toEqual([]);
  });
});
