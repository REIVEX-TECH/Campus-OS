import type { Translate } from '@/lib/i18n';
import type { GrantModalLabels } from '@/app/_components/admin/grant-reason-modal';

export type GrantBannerLabels = {
  active: string;
  reason: string;
  timeLeft: string;
  expiringSoon: string;
  close: string;
  closing: string;
  reopen: string;
};

/**
 * All the strings the grant lifecycle UI needs, resolved once on the server and
 * handed to the client components. `{tenant}` is left as a literal for the client
 * to interpolate, since the /admin list opens the modal for many tenants.
 */
export function grantModalLabels(t: Translate): GrantModalLabels {
  return {
    heading: t('platform.grant.modal.heading'),
    intro: t('platform.grant.modal.intro'),
    reasonField: t('platform.grant.modal.reasonField'),
    reasonHint: t('platform.grant.modal.reasonHint'),
    sameReason: t('platform.grant.modal.sameReason'),
    submit: t('platform.grant.modal.submit'),
    submitting: t('platform.grant.modal.submitting'),
    cancel: t('platform.grant.modal.cancel'),
    failed: t('platform.grant.modal.failed'),
    errors: {
      already_open: t('platform.grant.error.already_open'),
      reason_too_short: t('platform.grant.error.reason_too_short'),
      unknown_tenant: t('platform.grant.error.unknown_tenant'),
      forbidden: t('platform.grant.error.forbidden'),
    },
  };
}

export function grantBannerLabels(t: Translate): GrantBannerLabels {
  return {
    active: t('platform.grant.banner.active'),
    reason: t('platform.grant.banner.reason'),
    timeLeft: t('platform.grant.banner.timeLeft'),
    expiringSoon: t('platform.grant.banner.expiringSoon'),
    close: t('platform.grant.banner.close'),
    closing: t('platform.grant.banner.closing'),
    reopen: t('platform.grant.banner.reopen'),
  };
}
