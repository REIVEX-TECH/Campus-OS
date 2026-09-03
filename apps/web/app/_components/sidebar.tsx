'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleIconName } from '@/lib/modules';
import { LogoMark } from './logo-mark';
import { ModuleIcon } from './module-icon';
import {
  SidebarAccountRow,
  type SidebarAccount,
  type SidebarAccountLabels,
} from './sidebar-account';
import type { FirebaseWebConfig } from './use-google-sign-in';
import { ThemeToggle } from './theme-toggle';

export type SidebarItem = {
  key: string;
  label: string;
  icon: ModuleIconName;
  href: string;
  soon: boolean;
};

export type { SidebarAccount };

export type SidebarLabels = {
  modules: string;
  menu: string;
  close: string;
  collapse: string;
  expand: string;
  theme: string;
  comingSoon: string;
  account: SidebarAccountLabels;
};

/**
 * The persistent left navigation. Two independent behaviours:
 *  - Desktop collapse (icons-only) is persisted and driven by `data-sidebar` on
 *    <html>, set pre-paint by a script in the shell, so there is no flash. Its
 *    state is mirrored into React only to expose `aria-pressed` / a state label.
 *  - Mobile drawer: a real modal. Opening moves focus in and makes the rest of
 *    the shell `inert` (so focus and the screen-reader cursor stay in the drawer);
 *    Escape, the backdrop, and the close button all close it and return focus to
 *    the hamburger. Always closed on load, so the initial render is deterministic.
 */
export function Sidebar({
  tenantName,
  homeHref,
  signInHref,
  account,
  firebase,
  items,
  labels,
}: {
  tenantName: string;
  homeHref: string;
  signInHref: string;
  account: SidebarAccount;
  /** Null when the deployment has no provider, so the row is a plain link. */
  firebase: FirebaseWebConfig | null;
  items: SidebarItem[];
  labels: SidebarLabels;
}) {
  const pathname = usePathname();
  const live = items.filter((i) => !i.soon);
  const soon = items.filter((i) => i.soon);

  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Reflect the persisted collapse state (set pre-paint on <html>) into aria.
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === 'collapsed');
  }, []);

  const dropInert = useCallback((): void => {
    document.getElementById('main')?.removeAttribute('inert');
    topbarRef.current?.removeAttribute('inert');
  }, []);

  // Close and return focus to the hamburger; used by Escape, the backdrop, and
  // the X. Inert is dropped synchronously first so the hamburger is focusable.
  const closeAndReturnFocus = useCallback((): void => {
    dropInert();
    setOpen(false);
    menuBtnRef.current?.focus();
  }, [dropInert]);

  // Close without moving focus; used by nav links, which navigate the page.
  const closeForNav = useCallback((): void => {
    dropInert();
    setOpen(false);
  }, [dropInert]);

  // While the drawer is open it is a modal: the rest of the shell is inert, so
  // Tab and the SR cursor cannot leave it. Escape closes it.
  useEffect(() => {
    if (!open) return;
    const main = document.getElementById('main');
    const bar = topbarRef.current;
    main?.setAttribute('inert', '');
    bar?.setAttribute('inert', '');
    // Move focus into the drawer on the next frame, after inert has blurred the
    // hamburger, so it lands reliably (not on <body>). Focus the dialog container
    // (tabIndex -1) rather than a child, the standard modal-open pattern.
    const raf = requestAnimationFrame(() => {
      drawerRef.current?.focus();
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeAndReturnFocus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      main?.removeAttribute('inert');
      bar?.removeAttribute('inert');
    };
  }, [open, closeAndReturnFocus]);

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
      <div ref={topbarRef} className="app-topbar" data-print-hide>
        <button
          ref={menuBtnRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={labels.menu}
          aria-expanded={open}
          className="ios-pressable grid h-9 w-9 place-items-center rounded-lg text-foreground"
        >
          <MenuIcon />
        </button>
        <Link href={homeHref} aria-label={tenantName} className="flex min-w-0 items-center gap-2">
          <LogoMark size={22} className="shrink-0" />
          <span className="min-w-0 truncate text-base font-semibold tracking-tight">
            {tenantName}
          </span>
        </Link>
        <div className="ml-auto">
          <ThemeToggle label={labels.theme} />
        </div>
      </div>

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
        aria-label={open ? tenantName : undefined}
        tabIndex={open ? -1 : undefined}
      >
        <div className="sidebar-head">
          <Link
            href={homeHref}
            onClick={closeForNav}
            aria-label={tenantName}
            className="sidebar-brand-link min-w-0"
          >
            <LogoMark size={22} className="shrink-0" />
            <span className="sidebar-brand sidebar-label min-w-0 truncate">{tenantName}</span>
          </Link>
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

        <div className="sidebar-foot">
          <SidebarAccountRow
            account={account}
            signInHref={signInHref}
            firebase={firebase}
            labels={labels.account}
            onNavigate={closeForNav}
          />
          <ThemeToggle label={labels.theme} />
        </div>
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
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
