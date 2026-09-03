import type { ReactNode } from 'react';
import { translator, type MessageKey } from '@/lib/i18n';
import { currentActor } from '@/lib/auth';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { MODULES } from '@/lib/modules';
import { ChromeProvider } from './chrome-context';
import { Sidebar, type SidebarItem } from './sidebar';
import { SkipLink } from './skip-link';
import { TopBar } from './top-bar';

/**
 * Tenant app shell: a sticky top bar over a persistent left module nav beside
 * the page content.
 *
 * The bar carries the brand, the search and the account; the sidebar under it is
 * navigation alone, collapsing to icons on desktop (persisted) and becoming a
 * drawer on a phone. The page never scrolls sideways and no panel has its own
 * scrollbar: the bar is sticky, the sidebar is sticky and short, the content
 * grows and the page scrolls. Pages compose their centre and optional right rail
 * with `PageShell`. The platform landing uses its own simpler header, not this.
 */

// Resolve the persisted collapse state before first paint (no flash / no layout
// shift): sets `data-sidebar` on <html>, which the shell CSS reads for the
// sidebar width. Mirrors the theme script in the root layout.
const SIDEBAR_SCRIPT = `(function(){try{var s=localStorage.getItem('campusos_sidebar');document.documentElement.dataset.sidebar=s==='collapsed'?'collapsed':'expanded';}catch(e){document.documentElement.dataset.sidebar='expanded';}})();`;

export async function AppShell({
  tenantName,
  tenantSlug,
  base,
  locale,
  children,
}: {
  tenantName: string;
  tenantSlug: string;
  base: string;
  locale: string;
  children: ReactNode;
}) {
  const t = translator(locale);
  // Cheap when nobody is signed in: with no session cookie this does not touch
  // the database at all, so a public timetable pays nothing for it.
  const actor = await currentActor();
  const items: SidebarItem[] = MODULES.filter((m) => !m.hideFromNav).map((m) => ({
    key: m.key,
    label: t(`module.${m.key}.label` as MessageKey),
    icon: m.icon,
    href: m.soon ? `${base}/soon/${m.key}` : `${base}${m.path ?? ''}`,
    soon: m.soon,
  }));

  return (
    <ChromeProvider>
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_SCRIPT }} />
      <SkipLink label={t('a11y.skipToContent')} />
      <div className="app-frame">
        <TopBar
          tenantName={tenantName}
          tenant={tenantSlug}
          homeHref={base || '/'}
          searchHref={`${base}/search`}
          signInHref={`${base}/signin`}
          account={
            actor
              ? { handle: actor.handle, avatarSeed: actor.avatarSeed, href: `${base}/account` }
              : null
          }
          firebase={firebaseWebConfig()}
          labels={{
            menu: t('nav.menu'),
            search: t('nav.search'),
            searchPlaceholder: t('search.placeholder'),
            closeSearch: t('nav.closeSearch'),
            theme: t('theme.toggle'),
            account: {
              signIn: t('signin.heading'),
              working: t('signin.working'),
              failed: t('signin.failed'),
              retry: t('signin.retry'),
              menu: t('nav.accountMenu'),
              account: t('account.heading'),
              signOut: t('signin.signOut'),
              signingOut: t('signin.signingOut'),
            },
          }}
        />
        <div className="app-shell">
          <Sidebar
            items={items}
            labels={{
              modules: t('nav.modules'),
              close: t('nav.close'),
              collapse: t('nav.collapse'),
              expand: t('nav.expand'),
              comingSoon: t('modules.comingSoon'),
            }}
          />
          <main id="main" tabIndex={-1} className="app-content outline-none">
            {children}
          </main>
        </div>
      </div>
    </ChromeProvider>
  );
}
