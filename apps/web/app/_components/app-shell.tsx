import type { ReactNode } from 'react';
import { translator, type MessageKey } from '@/lib/i18n';
import { currentActor } from '@/lib/auth';
import { MODULES } from '@/lib/modules';
import { Sidebar, type SidebarItem } from './sidebar';
import { SkipLink } from './skip-link';

/**
 * Tenant app shell: a persistent left module nav beside the page content, in a
 * Reddit-style frame. The sidebar collapses to icons on desktop (persisted) and
 * becomes a hamburger drawer on mobile; the page never scrolls sideways and no
 * panel has its own scrollbar (the sidebar is sticky and short, the content
 * grows and the page scrolls). Pages compose their center + optional right rail
 * with `PageShell`. The platform landing uses its own simpler header, not this.
 */

// Resolve the persisted collapse state before first paint (no flash / no layout
// shift): sets `data-sidebar` on <html>, which the shell CSS reads for the
// sidebar width. Mirrors the theme script in the root layout.
const SIDEBAR_SCRIPT = `(function(){try{var s=localStorage.getItem('campusos_sidebar');document.documentElement.dataset.sidebar=s==='collapsed'?'collapsed':'expanded';}catch(e){document.documentElement.dataset.sidebar='expanded';}})();`;

export async function AppShell({
  tenantName,
  base,
  locale,
  children,
}: {
  tenantName: string;
  base: string;
  locale: string;
  children: ReactNode;
}) {
  const t = translator(locale);
  // Cheap when nobody is signed in: with no session cookie this does not touch
  // the database at all, so a public timetable pays nothing for it.
  const actor = await currentActor();
  const items: SidebarItem[] = MODULES.map((m) => ({
    key: m.key,
    label: t(`module.${m.key}.label` as MessageKey),
    icon: m.icon,
    href: m.soon ? `${base}/soon/${m.key}` : `${base}${m.path ?? ''}`,
    soon: m.soon,
  }));

  return (
    <div className="app-shell">
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_SCRIPT }} />
      <SkipLink label={t('a11y.skipToContent')} />
      <Sidebar
        tenantName={tenantName}
        homeHref={base || '/'}
        signInHref={`${base}/signin`}
        account={actor ? { handle: actor.handle, userId: actor.userId } : null}
        items={items}
        labels={{
          modules: t('nav.modules'),
          menu: t('nav.menu'),
          close: t('nav.close'),
          collapse: t('nav.collapse'),
          expand: t('nav.expand'),
          theme: t('theme.toggle'),
          comingSoon: t('modules.comingSoon'),
          signIn: t('signin.heading'),
        }}
      />
      <main id="main" tabIndex={-1} className="app-content outline-none">
        {children}
      </main>
    </div>
  );
}
