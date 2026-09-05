import { PlatformSignIn } from '@/app/_components/platform-sign-in';

export const dynamic = 'force-dynamic';

/**
 * The platform login at campusos.reivex.io/login: the same platform-host sign in
 * served at /signin, under the name a platform admin reaches for. On a tenant
 * host this path is rewritten to the tenant tree by middleware.
 */
export default function PlatformLoginPage() {
  return <PlatformSignIn />;
}
