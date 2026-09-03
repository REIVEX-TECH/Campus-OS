import Link from 'next/link';
import type { PermissionSet } from '@campusos/core';
import { visibleAdminSections, type AdminSectionKey } from '@/lib/admin-sections';
import type { Translate } from '@/lib/i18n';

/**
 * The admin area's sections, only those the signed in person may open. With a
 * single section there is nothing to move between, so nothing is drawn.
 */
export function AdminNav({
  base,
  permissions,
  current,
  t,
}: {
  base: string;
  permissions: PermissionSet;
  current: AdminSectionKey;
  t: Translate;
}) {
  const sections = visibleAdminSections(permissions);
  if (sections.length < 2) return null;
  return (
    <nav aria-label={t('admin.nav.label')} className="flex flex-wrap items-center gap-1 px-1">
      {sections.map((s) => {
        const active = s.key === current;
        return (
          <Link
            key={s.key}
            href={`${base}${s.path}`}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-lg bg-muted px-3 py-1.5 text-sm font-semibold text-foreground'
                : 'ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
            }
          >
            {t(s.label)}
          </Link>
        );
      })}
    </nav>
  );
}
