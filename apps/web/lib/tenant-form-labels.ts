import type { TenantFormLabels } from '@/app/_components/platform/tenant-form';
import type { Translate } from './i18n';

/** The form's strings, once, for the create and edit pages. */
export function tenantFormLabels(t: Translate, submit: string, done: string): TenantFormLabels {
  return {
    slug: t('platform.admin.field.slug'),
    displayName: t('platform.admin.field.displayName'),
    timezone: t('platform.admin.field.timezone'),
    locale: t('platform.admin.field.locale'),
    timeFormat: t('platform.admin.field.timeFormat'),
    timeFormat12h: t('platform.admin.field.timeFormat.12h'),
    timeFormat24h: t('platform.admin.field.timeFormat.24h'),
    primaryColor: t('platform.admin.field.primaryColor'),
    logoPath: t('platform.admin.field.logoPath'),
    aliases: t('platform.admin.field.aliases'),
    adminEmails: t('platform.admin.field.adminEmails'),
    adminEmailsHint: t('platform.admin.field.adminEmailsHint'),
    enabledModules: t('platform.admin.field.enabledModules'),
    seoTitleTemplate: t('platform.admin.field.seoTitleTemplate'),
    seoDescription: t('platform.admin.field.seoDescription'),
    seoKeywords: t('platform.admin.field.seoKeywords'),
    seoAliases: t('platform.admin.field.seoAliases'),
    listHint: t('platform.admin.field.listHint'),
    submit,
    working: t('platform.admin.working'),
    done,
    exists: t('platform.admin.exists'),
    invalid: t('platform.admin.invalid', { issues: '{issues}' }),
    failed: t('platform.admin.failed'),
  };
}
