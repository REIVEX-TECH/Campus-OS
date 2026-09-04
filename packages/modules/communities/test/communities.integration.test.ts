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
import { universities } from '@campusos/db/schema';
import { manifest as identityManifest } from '@campusos/module-identity/manifest';
import {
  ensureConfiguredAdmin,
  ensureDomainMembership,
} from '@campusos/module-identity/membership';
import { createRole, grantRole } from '@campusos/module-identity/rbac';
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
import { listCommunityPosts } from '../src/feed';
import { migrationsFolder, migrationsTable, settingsSchema } from '../src/manifest';
import { listMembers, listModerators } from '../src/members';
import { listRules, setRules } from '../src/rules';
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
import { hideItem, listSavedPosts, saveItem } from '../src/saved';
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
  );
  await getDb()
    .insert(universities)
    .values([
      { slug: 'aaa', name: 'Alpha U', timezone: 'Asia/Karachi' },
      { slug: 'bbb', name: 'Beta U', timezone: 'Asia/Karachi' },
    ])
    .onConflictDoNothing();
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

/** A tenant administrator, through the configured list. */
async function admin(subject: string, tenant = 'aaa') {
  const actor = await findOrCreateUser({ subject, email: `${subject}@gmail.com` });
  await ensureConfiguredAdmin(actor, { slug: tenant, adminEmails: [`${subject}@gmail.com`] });
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
    post_votes: true,
    comments: true,
    comment_edits: true,
    comment_votes: true,
    saved_items: true,
    hidden_items: true,
    reports: true,
    moderation_actions: true,
    automod_rules: true,
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
    expect(await joinCommunity(joiner, 'aaa', c.id)).toEqual({ ok: true, value: { joined: true } });
    expect(await joinCommunity(joiner, 'aaa', c.id)).toEqual({
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
    await joinCommunity(helper, 'aaa', c.id);

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
    expect(await joinCommunity(nobody, 'aaa', c.id)).toEqual({ ok: false, error: 'not_verified' });

    await joinCommunity(target, 'aaa', c.id);
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
    const c = await community(owner);
    await joinCommunity(voter, 'aaa', c.id);
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
    expect(await votePost(owner, 'aaa', post.value.id, 1)).toEqual({
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

  it.skipIf(!split)('does not let the application role read author_id at all', async () => {
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
    await joinCommunity(author, 'aaa', c.id);
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
    await joinCommunity(author, 'aaa', c.id);
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
    await joinCommunity(author, 'aaa', c.id);
    await joinCommunity(reporter, 'aaa', c.id);
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

    const role = await createRole(tenantAdmin, 'aaa', {
      name: 'Trust and Safety',
      permissions: ['communities.unmask'],
    });
    expect(role.ok).toBe(true);
    expect(await grantRole(tenantAdmin, 'aaa', tenantAdmin.userId, 'trust-and-safety')).toEqual({
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
    await joinCommunity(plain, 'aaa', c.id);
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
    await joinCommunity(plain, 'aaa', c.id);
    await joinCommunity(mod, 'aaa', c.id);
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
    await joinCommunity(voter, 'aaa', c.id);
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
