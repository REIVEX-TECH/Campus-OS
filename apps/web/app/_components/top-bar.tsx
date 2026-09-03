'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { AccountMenu, type AccountLabels, type TopAccount } from './account-menu';
import { useChrome } from './chrome-context';
import { LogoMark } from './logo-mark';
import { ThemeToggle } from './theme-toggle';
import { SearchIcon, TopSearch } from './top-search';
import type { FirebaseWebConfig } from './use-google-sign-in';

/**
 * The persistent top bar: brand on the left, search in the middle, the account
 * and the theme on the right. Sticky, full width, on every tenant page.
 *
 * It carries the brand, so the sidebar below it is pure navigation and the name
 * is not written twice. On a phone the bar is the hamburger, the mark, and the
 * account; search collapses to an icon that takes the bar's width when opened,
 * which is the one place the layout differs rather than being scaled down.
 */

export type TopBarLabels = {
  menu: string;
  search: string;
  searchPlaceholder: string;
  closeSearch: string;
  theme: string;
  account: AccountLabels;
};

export function TopBar({
  tenantName,
  tenant,
  homeHref,
  searchHref,
  signInHref,
  account,
  firebase,
  labels,
}: {
  tenantName: string;
  tenant: string;
  homeHref: string;
  searchHref: string;
  signInHref: string;
  account: TopAccount;
  firebase: FirebaseWebConfig | null;
  labels: TopBarLabels;
}) {
  const { openDrawer, menuButtonRef } = useChrome();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header id="app-topbar" className="app-topbar" data-print-hide>
      <div className="app-topbar-inner">
        {/* Brand and hamburger step aside while a phone is searching. */}
        <div
          className={`flex min-w-0 items-center gap-1 ${searchOpen ? 'hidden sm:flex' : 'flex'}`}
        >
          <button
            ref={menuButtonRef}
            type="button"
            onClick={openDrawer}
            aria-label={labels.menu}
            className="ios-pressable grid h-9 w-9 shrink-0 place-items-center rounded-lg text-foreground md:hidden"
          >
            <MenuIcon />
          </button>
          <Link
            href={homeHref}
            aria-label={tenantName}
            className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1"
          >
            <LogoMark size={24} className="shrink-0" />
            <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-foreground">
              {tenantName}
            </span>
          </Link>
        </div>

        <div
          className={`min-w-0 flex-1 items-center ${searchOpen ? 'flex' : 'hidden sm:flex'} sm:px-2`}
        >
          {/* useSearchParams needs a boundary; the bar renders on every page. */}
          <Suspense fallback={<div className="h-9 flex-1" />}>
            <TopSearch
              searchHref={searchHref}
              placeholder={labels.searchPlaceholder}
              expanded={searchOpen}
              onCollapse={() => setSearchOpen(false)}
            />
          </Suspense>
          {searchOpen ? (
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              aria-label={labels.closeSearch}
              className="ios-pressable ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground sm:hidden"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>

        <div
          className={`ml-auto flex shrink-0 items-center gap-1.5 ${searchOpen ? 'hidden sm:flex' : 'flex'}`}
        >
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={labels.search}
            className="ios-pressable grid h-9 w-9 place-items-center rounded-full text-foreground sm:hidden"
          >
            <SearchIcon />
          </button>
          <ThemeToggle label={labels.theme} />
          <AccountMenu
            account={account}
            signInHref={signInHref}
            firebase={firebase}
            tenant={tenant}
            labels={labels.account}
          />
        </div>
      </div>
    </header>
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
