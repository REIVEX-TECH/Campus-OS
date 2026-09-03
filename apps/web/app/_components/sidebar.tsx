'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ModuleIconName } from '@/lib/modules';
import { useChrome } from './chrome-context';
import { ModuleIcon } from './module-icon';

export type SidebarItem = {
  key: string;
  label: string;
  icon: ModuleIconName;
  href: string;
  soon: boolean;
};

export type SidebarLabels = {
  modules: string;
  close: string;
  collapse: string;
  expand: string;
  comingSoon: string;
};

/**
 * The left navigation, and nothing else.
 *
 * The brand and the account moved to the top bar, so this is the module list on
 * its own: what the sidebar is for, and one name on the page rather than two.
 *
 * Two independent behaviours remain. Desktop collapse (icons only) is persisted
 * and driven by `data-sidebar` on <html>, set before paint by a script in the
 * shell, so there is no flash; React mirrors it only to expose the state to
 * assistive tech. On a phone it is a drawer, opened by the hamburger in the top
 * bar and closed by Escape, the backdrop, or a link; the modal behaviour lives
 * in `ChromeProvider`, which both halves share.
 */
export function Sidebar({ items, labels }: { items: SidebarItem[]; labels: SidebarLabels }) {
  const pathname = usePathname();
  const { open, closeAndReturnFocus, closeForNav, drawerRef } = useChrome();
  const live = items.filter((i) => !i.soon);
  const soon = items.filter((i) => i.soon);

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === 'collapsed');
  }, []);

  function toggleCollapse(): void {
    const next =
      document.documentElement.dataset.sidebar === 'collapsed' ? 'expanded' : 'collapsed';
    document.documentElement.dataset.sidebar = next;
    setCollapsed(next === 'collapsed');
    try {
      localStorage.setItem('campusos_sidebar', next);
    } catch {
      // storage unavailable (private mode); the toggle still applies for this view.
    }
  }

  const isActive = (href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);
  const collapseLabel = collapsed ? labels.expand : labels.collapse;

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label={labels.close}
          onClick={closeAndReturnFocus}
          className="app-backdrop"
          tabIndex={-1}
        />
      ) : null}

      <div
        ref={drawerRef}
        className={`app-sidebar${open ? ' is-open' : ''}`}
        data-print-hide
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? labels.modules : undefined}
        tabIndex={open ? -1 : undefined}
      >
        <div className="sidebar-head">
          <button
            type="button"
            onClick={toggleCollapse}
            aria-pressed={collapsed}
            aria-label={collapseLabel}
            title={collapseLabel}
            className="sidebar-collapse ios-pressable"
          >
            <MenuIcon />
          </button>
          <button
            type="button"
            onClick={closeAndReturnFocus}
            aria-label={labels.close}
            className="sidebar-close ios-pressable"
          >
            <CloseIcon />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label={labels.modules}>
          <ul>
            {live.map((n) => (
              <li key={n.key}>
                <Link
                  href={n.href}
                  onClick={closeForNav}
                  aria-current={isActive(n.href) ? 'page' : undefined}
                  aria-label={n.label}
                  title={n.label}
                  className={`sidebar-item ios-pressable${isActive(n.href) ? ' is-active' : ''}`}
                >
                  <span className="sidebar-icon">
                    <ModuleIcon name={n.icon} className="sidebar-icon-svg" />
                  </span>
                  <span className="sidebar-label">{n.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <ul className="sidebar-soon">
            {soon.map((n) => (
              <li key={n.key}>
                <span className="sidebar-item is-soon" title={`${n.label} (${labels.comingSoon})`}>
                  <span className="sidebar-icon">
                    <ModuleIcon name={n.icon} className="sidebar-icon-svg" />
                  </span>
                  <span className="sidebar-label">{n.label}</span>
                  <span className="sidebar-soon-tag sidebar-label">{labels.comingSoon}</span>
                </span>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}

function MenuIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
