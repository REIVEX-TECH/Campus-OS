import Link from 'next/link';
import { buttonVariants } from '@campusos/ui';
import { translator } from '@/lib/i18n';
import { ApplyTheme } from './_components/apply-theme';

// The global 404 boundary. It renders outside any tenant (an unknown tenant is
// one reason it fires), so it uses the default locale and links to the platform
// home rather than a tenant home.
export default function NotFound() {
  const t = translator('en');
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <ApplyTheme />
      <h1 className="text-7xl font-bold tracking-tight text-muted-foreground">
        {t('notFound.title')}
      </h1>
      <p className="max-w-prose text-muted-foreground">{t('notFound.body')}</p>
      <Link className={buttonVariants({ variant: 'outline' })} href="/">
        {t('notFound.home')}
      </Link>
    </main>
  );
}
