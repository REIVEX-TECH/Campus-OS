import type { PostFormLabels } from '@/app/_components/communities/post-form';
import { communityErrors } from './community-labels';
import type { Translate } from './i18n';

export function postErrors(t: Translate): Record<string, string> {
  return {
    ...communityErrors(t),
    locked: t('posts.error.locked'),
    kind_not_allowed: t('posts.error.kind_not_allowed'),
    anonymous_not_allowed: t('posts.error.anonymous_not_allowed'),
    exists: t('posts.error.exists'),
    archived: t('posts.error.archived'),
    depth: t('posts.error.depth'),
  };
}

export function postFormLabels(t: Translate, mode: 'create' | 'edit'): PostFormLabels {
  return {
    text: t('posts.compose.text'),
    link: t('posts.compose.link'),
    title: t('posts.compose.title'),
    body: t('posts.compose.body'),
    url: t('posts.compose.url'),
    anonymous: t('posts.compose.anonymous'),
    anonymousHint: t('posts.compose.anonymousHint'),
    spoiler: t('posts.compose.spoiler'),
    submit: mode === 'create' ? t('posts.compose.submit') : t('posts.edit.submit'),
    working: t('communities.working'),
    done: t('posts.edit.saved'),
    errors: postErrors(t),
  };
}
