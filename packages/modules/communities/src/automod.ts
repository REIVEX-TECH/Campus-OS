import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withActorInTenant, type TenantTransaction } from '@campusos/db';
import { err, ok, type Result } from '@campusos/core';
import { communityPermissions, type Refusal } from './access';
import { moderates } from './mod-actions';
import { automodRules, moderationActions } from './schema/communities';

/**
 * Automod, the small kind: a community's moderators keep a list of keywords
 * and link domains, each with what to do on a match. "queue" holds the item
 * for a moderator (it is stored removed, with a reason code, and shows in the
 * Held tab); "remove" takes it down outright. Screening runs inside the same
 * transaction as the insert, so a held item is never visible in between. The
 * rules are the moderators' to see: publishing a filter is a guide to evading
 * it. Log lines are written by the system actor, not by whoever posted.
 */

export const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
export const HELD_BY_FILTER = 'automod:queue';
export const REMOVED_BY_FILTER = 'automod:remove';
export const HIDDEN_BY_REPORTS = 'auto:reports';

export const automodRuleSchema = z.object({
  kind: z.enum(['keyword', 'domain']),
  pattern: z.string().trim().min(2).max(100),
  action: z.enum(['queue', 'remove']),
});
export const automodRulesSchema = z.array(automodRuleSchema).max(50);
export type AutomodRuleInput = z.input<typeof automodRuleSchema>;

export interface AutomodRule {
  id: string;
  kind: 'keyword' | 'domain';
  pattern: string;
  action: 'queue' | 'remove';
}

export interface Verdict {
  action: 'queue' | 'remove';
  kind: 'keyword' | 'domain';
  pattern: string;
}

/** Match text and a link domain against a community's rules. Remove outranks queue. */
export async function screen(
  tx: TenantTransaction,
  communityId: string,
  item: { text: string; domain: string | null },
): Promise<Verdict | null> {
  const rules = await tx
    .select({ kind: automodRules.kind, pattern: automodRules.pattern, action: automodRules.action })
    .from(automodRules)
    .where(eq(automodRules.communityId, communityId));
  if (rules.length === 0) return null;
  const text = item.text.toLowerCase();
  const domain = item.domain?.toLowerCase() ?? null;
  let verdict: Verdict | null = null;
  for (const r of rules) {
    const pattern = r.pattern.toLowerCase();
    const hit =
      r.kind === 'keyword'
        ? text.includes(pattern)
        : domain !== null && (domain === pattern || domain.endsWith(`.${pattern}`));
    if (!hit) continue;
    const found = {
      action: r.action as Verdict['action'],
      kind: r.kind as Verdict['kind'],
      pattern: r.pattern,
    };
    if (found.action === 'remove') return found;
    verdict ??= found;
  }
  return verdict;
}

/** The removal reason code for a verdict, and the log line that explains it. */
export async function applyVerdict(
  tx: TenantTransaction,
  tenantId: string,
  communityId: string,
  target: { type: 'post' | 'comment'; id: string; postId: string },
  verdict: Verdict,
): Promise<string> {
  await tx.insert(moderationActions).values({
    tenantId,
    communityId,
    actorId: SYSTEM_ACTOR,
    action: verdict.action === 'remove' ? 'automod_remove' : 'automod_hold',
    targetType: target.type,
    targetId: target.id,
    reason: null,
    meta: { postId: target.postId, kind: verdict.kind, pattern: verdict.pattern },
  });
  return verdict.action === 'remove' ? REMOVED_BY_FILTER : HELD_BY_FILTER;
}

/** A community's rules, for its moderators. */
export async function listAutomodRules(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
): Promise<Result<AutomodRule[], Refusal>> {
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    if (!(await moderates(tx, actor.userId, tenantId, communityId))) return err('not_allowed');
    const rows = await tx
      .select({
        id: automodRules.id,
        kind: automodRules.kind,
        pattern: automodRules.pattern,
        action: automodRules.action,
      })
      .from(automodRules)
      .where(eq(automodRules.communityId, communityId))
      .orderBy(asc(automodRules.createdAt));
    return ok(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind as AutomodRule['kind'],
        pattern: r.pattern,
        action: r.action as AutomodRule['action'],
      })),
    );
  });
}

/** Replace the rules. `communities.manage` here or `communities.oversee`, logged. */
export async function setAutomodRules(
  actor: { userId: string },
  tenantId: string,
  communityId: string,
  input: AutomodRuleInput[],
): Promise<Result<AutomodRule[], Refusal>> {
  const parsed = automodRulesSchema.safeParse(input);
  if (!parsed.success) return err('invalid');
  return withActorInTenant(actor.userId, tenantId, async (tx) => {
    const perms = await communityPermissions(tx, actor.userId, tenantId, communityId);
    if (!perms.hasAny('communities.manage', 'communities.oversee')) return err('not_allowed');
    await tx.delete(automodRules).where(eq(automodRules.communityId, communityId));
    const rows =
      parsed.data.length === 0
        ? []
        : await tx
            .insert(automodRules)
            .values(
              parsed.data.map((r) => ({
                tenantId,
                communityId,
                kind: r.kind,
                pattern: r.pattern,
                action: r.action,
                createdBy: actor.userId,
              })),
            )
            .returning({
              id: automodRules.id,
              kind: automodRules.kind,
              pattern: automodRules.pattern,
              action: automodRules.action,
            });
    await tx.insert(moderationActions).values({
      tenantId,
      communityId,
      actorId: actor.userId,
      action: 'automod.updated',
      targetType: 'community',
      targetId: communityId,
      meta: { count: rows.length },
    });
    return ok(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind as AutomodRule['kind'],
        pattern: r.pattern,
        action: r.action as AutomodRule['action'],
      })),
    );
  });
}
