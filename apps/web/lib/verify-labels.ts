import type { GetVerifiedLabels } from '@/app/_components/get-verified';
import type { Translate } from './i18n';

/** The "Get verified" button + modal strings, once, for every place it appears. */
export function getVerifiedLabels(t: Translate): GetVerifiedLabels {
  return {
    button: t('verify.getVerified'),
    heading: t('verify.modalHeading'),
    intro: t('verify.modalIntro'),
    howHeading: t('verify.howHeading'),
    howDomain: t('verify.howDomain'),
    howRequest: t('verify.howRequest'),
    close: t('verify.close'),
    form: {
      fullName: t('account.verification.fullName'),
      rollNumber: t('account.verification.rollNumber'),
      note: t('account.verification.note'),
      submit: t('account.verification.submit'),
      submitting: t('account.verification.submitting'),
      sent: t('account.verification.sent'),
      errorFormat: t('account.verification.errorFormat'),
      errorOpen: t('account.verification.errorOpen'),
      errorRate: t('account.verification.errorRate'),
      errorVerified: t('account.verification.errorVerified'),
      errorGeneric: t('account.verification.errorGeneric'),
    },
  };
}
