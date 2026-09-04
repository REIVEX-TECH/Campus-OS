import Link from 'next/link';
import { PERMISSIONS } from '@campusos/core';
import { listRoleTemplates } from '@campusos/module-identity/role-templates';
import { RoleDefinitions } from '@/app/_components/platform/role-definitions';
import { requirePlatformAdmin } from '@/lib/auth';
import { translator, type MessageKey } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

/**
 * The role definitions, for the platform.
 *
 * Which roles exist and what each carries, for every university at once. A
 * university's administrators see these read only on their own roles page and
 * grant them from their members page; nobody but a platform administrator
 * changes what a role means.
 */
export default async function PlatformRolesPage() {
  await requirePlatformAdmin();
  const t = translator('en');
  const templates = await listRoleTemplates();
  const permissionLabels = Object.fromEntries(
    PERMISSIONS.map((p) => [p, t(`admin.roles.permission.${p}` as MessageKey)]),
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('platform.roles.heading')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('platform.roles.intro')}</p>
      </header>

      <RoleDefinitions
        templates={templates.map((template) => ({
          key: template.key,
          name: template.name,
          isSystem: template.isSystem,
          permissions: template.permissions,
        }))}
        permissions={[...PERMISSIONS]}
        permissionLabels={permissionLabels}
        labels={{
          builtIn: t('admin.roles.builtIn'),
          builtInNote: t('platform.roles.builtInNote'),
          permissions: t('admin.roles.permissions'),
          none: t('admin.roles.none'),
          save: t('admin.roles.save'),
          saved: t('admin.roles.saved'),
          newTemplate: t('platform.roles.new'),
          name: t('admin.roles.name'),
          create: t('admin.roles.create'),
          created: t('admin.roles.created', { name: '{name}' }),
          remove: t('platform.roles.remove'),
          removeConfirm: t('platform.roles.removeConfirm'),
          removed: t('platform.roles.removed'),
          exists: t('admin.roles.exists'),
          badName: t('admin.roles.badName'),
          working: t('admin.roles.working'),
          failed: t('admin.roles.failed'),
        }}
      />

      <p className="text-sm">
        <Link href="/admin" className="font-medium text-primary hover:underline">
          {t('platform.roles.back')}
        </Link>
      </p>
    </main>
  );
}
