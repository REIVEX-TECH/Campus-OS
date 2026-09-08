import type { ReactNode } from 'react';
import { translator, type MessageKey } from '@/lib/i18n';
import { currentActor } from '@/lib/auth';
import { firebaseWebConfig } from '@/lib/firebase-config';
import { myCommunities } from '@campusos/module-communities/communities';
import { COMMUNITIES } from '@/lib/communities';
import { MODULES } from '@/lib/modules';
import { ChromeProvider } from './chrome-context';
import { ChatWidget } from './messages/chat-widget';
import { ChatWidgetProvider } from './messages/chat-widget-context';
import { Sidebar, type SidebarGroup, type SidebarItem } from './sidebar';
import { SkipLink } from './skip-link';
import { buildMessagesLabels } from '@/lib/messages-labels';
import { messagesSettings } from '@/lib/messages';
import { getTenantRegistry } from '@/lib/tenants';
import { unreadCount } from '@campusos/module-notifications/inbox';
import {
  unreadCount as messagesUnread,
  requestCount as messagesRequests,
} from '@campusos/module-messages/service';
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
  enabledModules,
  children,
}: {
  tenantName: string;
  tenantSlug: string;
  base: string;
  locale: string;
  /** The tenant's enabled module ids: a disabled module contributes no link. */
  enabledModules: readonly string[];
  children: ReactNode;
}) {
  const t = translator(locale);
  // Cheap when nobody is signed in: with no session cookie this does not touch
  // the database at all, so a public timetable pays nothing for it.
  const actor = await currentActor();
  // Messages needing attention: unread messages plus inbound requests. One number
  // for the top-bar mail icon and the sidebar item, only where the module is on and
  // someone is signed in.
  const messagesOn = Boolean(actor) && enabledModules.includes('messages');
  const [msgUnread, msgRequests] = messagesOn
    ? await Promise.all([
        messagesUnread(actor!.userId, tenantSlug),
        messagesRequests(actor!.userId, tenantSlug),
      ])
    : [0, 0];
  const msgTotal = msgUnread + msgRequests;
  // The floating chat widget's config + labels, built once for the client panel.
  const msgSettings = messagesOn
    ? messagesSettings((await getTenantRegistry()).resolveBySlug(tenantSlug)!)
    : null;
  const msgLabels = messagesOn ? buildMessagesLabels(t) : null;
  const items: SidebarItem[] = MODULES.filter(
    (m) => !m.hideFromNav && (!m.moduleId || enabledModules.includes(m.moduleId)),
  ).map((m) => ({
    key: m.key,
    label: t(`module.${m.key}.label` as MessageKey),
    icon: m.icon,
    href: m.soon ? `${base}/soon/${m.key}` : `${base}${m.path ?? ''}`,
    soon: m.soon,
  }));
  // The communities a signed in person has joined, as a second section.
  const groups: SidebarGroup[] = [];
  // The bell: one unread count for a signed in person, across every module that
  // notifies (communities, L&F, marketplace, services, messages). Kind-agnostic, so
  // it is shown whenever someone is signed in, not gated on any one module.
  const unread = actor ? await unreadCount(actor, tenantSlug) : null;
  if (actor && enabledModules.includes(COMMUNITIES)) {
    const mine = await myCommunities(actor, tenantSlug);
    groups.push({
      key: 'yours',
      label: t('communities.yours'),
      items: mine.slice(0, 8).map((c) => ({
        key: c.id,
        label: c.name,
        href: `${base}/c/${c.slug}`,
        seed: c.iconSeed,
      })),
    });
  }

  return (
    <ChromeProvider>
      <ChatWidgetProvider>
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
            notifications={
              unread === null
                ? null
                : { href: `${base}/notifications`, unread, label: t('notifications.bell') }
            }
            messages={
              messagesOn
                ? {
                    href: `${base}/messages`,
                    count: msgTotal,
                    label: t('module.messages.label'),
                  }
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
              groups={groups}
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
        {messagesOn && msgLabels && msgSettings ? (
          <ChatWidget
            tenant={tenantSlug}
            base={base}
            selfUserId={actor!.userId}
            maxLength={msgSettings.maxBodyLength}
            editWindowMinutes={msgSettings.editWindowMinutes}
            deleteWindowMinutes={msgSettings.deleteEveryoneWindowMinutes}
            labels={msgLabels}
          />
        ) : null}
      </ChatWidgetProvider>
    </ChromeProvider>
  );
}
