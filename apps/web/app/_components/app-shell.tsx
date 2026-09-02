import Link from 'next/link';
import type { ReactNode } from 'react';
import { translator } from '@/lib/i18n';
import { SkipLink } from './skip-link';
import { ThemeToggle } from './theme-toggle';

/**
 * Full-width tenant app shell: a sticky frosted header (tenant name, nav, theme
 * toggle) over a full-width main. No max-w-3xl column, no divider lines (the
 * header separates by a translucent backdrop, not a hairline). Content uses the
 * whole viewport up to a wide cap; individual pages add narrow internal
 * max-widths only where reading comfort needs it.
 */
export function AppShell({
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
  const nav = [
    { href: `${base}/timetable`, label: t('nav.timetable') },
    { href: `${base}/free-rooms`, label: t('nav.freeRooms') },
    { href: `${base}/search`, label: t('nav.search') },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink label={t('a11y.skipToContent')} />
      <header
        data-print-hide
        className="sticky top-0 z-20 bg-background/85 shadow-[var(--shadow-card)] backdrop-blur"
      >
        <div className="mx-auto flex h-14 w-full max-w-[120rem] items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href={base || '/'}
            className="min-w-0 truncate text-base font-semibold tracking-tight"
          >
            {tenantName}
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
            <ThemeToggle label={t('theme.toggle')} />
          </nav>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[120rem] flex-1 px-4 py-6 outline-none sm:px-6"
      >
        {children}
      </main>
    </div>
  );
}
