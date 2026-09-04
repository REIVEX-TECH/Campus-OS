import type { CommunityFormLabels } from '@/app/_components/communities/community-form';
import type { Translate } from './i18n';

/** The refusal messages a communities control can show, once. */
export function communityErrors(t: Translate): Record<string, string> {
  return {
    not_verified: t('communities.error.not_verified'),
    not_allowed: t('communities.error.not_allowed'),
    banned: t('communities.error.banned'),
    exists: t('communities.error.exists'),
    rate_limited: t('communities.error.rate_limited'),
    invalid: t('communities.error.invalid'),
    last_owner: t('communities.error.last_owner'),
    muted: t('communities.error.muted'),
    pin_cap: t('communities.error.pin_cap'),
    self: t('communities.error.self'),
    rules_not_accepted: t('communities.error.rules_not_accepted'),
    archived: t('posts.error.archived'),
    failed: t('communities.error.failed'),
  };
}

export function communityFormLabels(t: Translate, mode: 'create' | 'edit'): CommunityFormLabels {
  return {
    name: t('communities.form.name'),
    description: t('communities.form.description'),
    allowAnonymous: t('communities.form.allowAnonymous'),
    allowAnonymousHint: t('communities.form.allowAnonymousHint'),
    kinds: t('communities.form.kinds'),
    kindText: t('communities.form.kind.text'),
    kindLink: t('communities.form.kind.link'),
    kindPoll: t('communities.form.kind.poll'),
    visibility: t('communities.form.visibility'),
    visibilityPublic: t('communities.form.visibility.public'),
    visibilityRestricted: t('communities.form.visibility.restricted'),
    modLogPublic: t('communities.form.modLogPublic'),
    submit: mode === 'create' ? t('communities.form.create') : t('communities.form.save'),
    working: t('communities.working'),
    done: t('communities.form.saved'),
    errors: communityErrors(t),
  };
}

/** A removal reason as a sentence: the codes automod and the threshold write, or a moderator's own words. */
export function removalLabel(reason: string, t: Translate): string {
  switch (reason) {
    case 'automod:queue':
      return t('posts.heldByFilter');
    case 'automod:remove':
      return t('posts.removedByFilter');
    case 'auto:reports':
      return t('posts.hiddenByReports');
    default:
      return t('posts.removedReason', { reason });
  }
}
