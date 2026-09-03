'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import { LoaderCircle, LogIn } from 'lucide-react';
import { IdentityAvatar } from './identity-avatar';
import { useGoogleSignIn, type FirebaseWebConfig } from './use-google-sign-in';

/** Who is signed in, or null. Only the public handle crosses to the client. */
export type SidebarAccount = { handle: string; avatarSeed: string; href: string } | null;

export type SidebarAccountLabels = {
  signIn: string;
  working: string;
  failed: string;
  retry: string;
};

/**
 * The account row at the foot of the sidebar.
 *
 * Signed in, it is a link to your account. Signed out, it is a link to the sign
 * in page that, when the provider is configured, signs you in directly instead:
 * one click from anywhere in the app, without a detour through a page whose only
 * job was to hold the button. The link stays a link underneath, so a middle
 * click, a modifier click, or a browser without script all still reach the page,
 * and the page remains the place that explains what an account is for.
 */
export function SidebarAccountRow({
  account,
  signInHref,
  firebase,
  labels,
  onNavigate,
}: {
  account: SidebarAccount;
  signInHref: string;
  firebase: FirebaseWebConfig | null;
  labels: SidebarAccountLabels;
  /** Closes the mobile drawer before a real navigation. */
  onNavigate: () => void;
}) {
  if (account) {
    return (
      <Link
        href={account.href}
        onClick={onNavigate}
        aria-label={account.handle}
        title={account.handle}
        className="sidebar-item ios-pressable"
      >
        <span className="sidebar-icon">
          <IdentityAvatar
            seed={account.avatarSeed}
            label={account.handle}
            size={20}
            className="sidebar-icon-svg"
          />
        </span>
        <span className="sidebar-label truncate">{account.handle}</span>
      </Link>
    );
  }

  if (!firebase) {
    return (
      <Link
        href={signInHref}
        onClick={onNavigate}
        aria-label={labels.signIn}
        title={labels.signIn}
        className="sidebar-item ios-pressable"
      >
        <span className="sidebar-icon">
          <LogIn className="sidebar-icon-svg" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="sidebar-label truncate">{labels.signIn}</span>
      </Link>
    );
  }

  return <DirectSignIn href={signInHref} firebase={firebase} labels={labels} />;
}

/**
 * Split out so the hook is only mounted when there is something for it to do.
 *
 * The drawer is deliberately left open while Google is working: on a phone the
 * sidebar is the only place the reader can see that anything is happening, and
 * once the session lands the row simply becomes their handle.
 */
function DirectSignIn({
  href,
  firebase,
  labels,
}: {
  href: string;
  firebase: FirebaseWebConfig;
  labels: SidebarAccountLabels;
}) {
  const { status, signIn } = useGoogleSignIn(firebase);

  function onClick(event: MouseEvent<HTMLAnchorElement>): void {
    // A modified or middle click means "open the page", as it does on any link.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (status !== 'working') void signIn();
  }

  const working = status === 'working';
  const label = working ? labels.working : status === 'failed' ? labels.retry : labels.signIn;

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={label}
      aria-busy={working || undefined}
      title={status === 'failed' ? labels.failed : label}
      className="sidebar-item ios-pressable"
    >
      <span className="sidebar-icon">
        {working ? (
          <LoaderCircle
            className="sidebar-icon-svg animate-spin"
            strokeWidth={2}
            aria-hidden="true"
          />
        ) : (
          <LogIn className="sidebar-icon-svg" strokeWidth={2} aria-hidden="true" />
        )}
      </span>
      <span className="sidebar-label truncate">{label}</span>
      {status === 'failed' ? (
        <span className="sr-only" role="status">
          {labels.failed}
        </span>
      ) : null}
    </Link>
  );
}
