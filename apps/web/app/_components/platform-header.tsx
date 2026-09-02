import Link from 'next/link';
import { translator } from '@/lib/i18n';
import { LogoMark } from './logo-mark';
import { ThemeToggle } from './theme-toggle';

const GITHUB_URL = 'https://github.com/REIVEX-TECH/Campus-OS';

/**
 * Minimal platform header: brand, a GitHub link, and the theme toggle. Sticky and
 * frosted like the tenant AppShell, with no divider line. Full-width up to a wide
 * cap. Used by the platform landing (which has no tenant nav).
 */
export function PlatformHeader({ locale = 'en' }: { locale?: string }) {
  const t = translator(locale);
  return (
    <header
      data-print-hide
      className="sticky top-0 z-20 bg-background/85 shadow-[var(--shadow-card)] backdrop-blur"
    >
      <div className="mx-auto flex h-14 w-full max-w-[120rem] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <LogoMark size={24} className="shrink-0" />
          CampusOS
        </Link>
        <nav className="flex items-center gap-1">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ios-pressable rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {t('platform.github')}
          </a>
          <ThemeToggle label={t('theme.toggle')} />
        </nav>
      </div>
    </header>
  );
}
