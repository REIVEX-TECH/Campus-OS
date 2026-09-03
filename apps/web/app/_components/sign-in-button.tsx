'use client';

import { LoaderCircle } from 'lucide-react';
import { buttonVariants } from '@campusos/ui';
import { useGoogleSignIn, type FirebaseWebConfig } from './use-google-sign-in';

export type { FirebaseWebConfig };

/**
 * The sign in page's button. The sign in itself lives in `useGoogleSignIn`, which
 * the sidebar shares; this component only decides how the button looks on the
 * page, where there is room for the accent button and a line of feedback.
 *
 * While Google is open the button is busy rather than disabled, so the working
 * label keeps its full contrast. The click guard, not the disabled attribute,
 * stops a second sign in from starting; the sidebar row does the same.
 */
export function SignInButton({
  config,
  tenant,
  labels,
}: {
  config: FirebaseWebConfig;
  /** Null on the platform host, where signing in joins no university. */
  tenant: string | null;
  labels: { signIn: string; working: string; failed: string };
}) {
  const { status, signIn } = useGoogleSignIn(config, tenant);
  const working = status === 'working';

  return (
    <div className="flex flex-col gap-2 sm:items-start">
      <button
        type="button"
        onClick={() => {
          if (!working) void signIn();
        }}
        aria-busy={working || undefined}
        className={buttonVariants({ className: 'w-full sm:w-auto' })}
      >
        {working ? (
          <LoaderCircle
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
            strokeWidth={2}
            aria-hidden="true"
          />
        ) : null}
        {working ? labels.working : labels.signIn}
      </button>
      {status === 'failed' ? (
        <p className="text-sm text-muted-foreground" role="status">
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
