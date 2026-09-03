'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { LoaderCircle, LogIn } from 'lucide-react';
import { IdentityAvatar } from './identity-avatar';
import { useGoogleSignIn, type FirebaseWebConfig } from './use-google-sign-in';

/**
 * The account corner of the top bar.
 *
 * Signed in it is the avatar and handle with a small menu; signed out it is a
 * sign in control that goes straight to Google when a provider is configured,
 * and stays a plain link to the sign in page when one is not.
 */

export type AccountLabels = {
  signIn: string;
  working: string;
  failed: string;
  retry: string;
  menu: string;
  account: string;
  signOut: string;
  signingOut: string;
};

export type TopAccount = { handle: string; avatarSeed: string; href: string } | null;

export function AccountMenu({
  account,
  signInHref,
  firebase,
  tenant,
  labels,
}: {
  account: TopAccount;
  signInHref: string;
  firebase: FirebaseWebConfig | null;
  tenant: string;
  labels: AccountLabels;
}) {
  if (account) return <SignedIn account={account} labels={labels} />;
  if (!firebase) {
    return (
      <Link
        href={signInHref}
        className="ios-pressable ios-field flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-foreground"
      >
        <LogIn className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        <span className="hidden sm:inline">{labels.signIn}</span>
      </Link>
    );
  }
  return <DirectSignIn href={signInHref} firebase={firebase} tenant={tenant} labels={labels} />;
}

/**
 * One click from anywhere. The control stays a link to the sign in page
 * underneath, so a middle click, a modifier click, or a browser without script
 * all still reach the page that explains what an account is for.
 */
function DirectSignIn({
  href,
  firebase,
  tenant,
  labels,
}: {
  href: string;
  firebase: FirebaseWebConfig;
  tenant: string;
  labels: AccountLabels;
}) {
  const { status, signIn } = useGoogleSignIn(firebase, tenant);
  const working = status === 'working';
  const label = working ? labels.working : status === 'failed' ? labels.retry : labels.signIn;

  function onClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (!working) void signIn();
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-busy={working || undefined}
      title={status === 'failed' ? labels.failed : label}
      className="ios-pressable ios-field flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-foreground"
    >
      {working ? (
        <LoaderCircle
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <LogIn className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      )}
      <span className="hidden sm:inline">{label}</span>
      {status === 'failed' ? (
        <span className="sr-only" role="status">
          {labels.failed}
        </span>
      ) : null}
    </Link>
  );
}

function SignedIn({
  account,
  labels,
}: {
  account: NonNullable<TopAccount>;
  labels: AccountLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const raf = requestAnimationFrame(() => firstItemRef.current?.focus());
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut(): Promise<void> {
    setBusy(true);
    await fetch('/api/auth/session', { method: 'DELETE' });
    setOpen(false);
    setBusy(false);
    router.refresh();
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={labels.menu}
        className="ios-pressable ios-field flex h-9 max-w-[10rem] items-center gap-2 rounded-full py-0 pl-0.5 pr-1 sm:pr-2.5"
      >
        <IdentityAvatar seed={account.avatarSeed} label={account.handle} size={30} />
        <span className="hidden min-w-0 truncate text-sm font-semibold text-foreground sm:inline">
          {account.handle}
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={labels.menu}
          className="ios-card absolute right-0 top-[calc(100%+0.5rem)] z-40 flex w-52 flex-col gap-0.5 rounded-2xl p-1.5 shadow-[var(--shadow-card-strong)]"
        >
          <p className="truncate px-2.5 py-1.5 text-sm font-semibold text-foreground">
            {account.handle}
          </p>
          <Link
            ref={firstItemRef}
            role="menuitem"
            href={account.href}
            onClick={() => setOpen(false)}
            className="ios-pressable rounded-xl px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {labels.account}
          </Link>
          <button
            role="menuitem"
            type="button"
            disabled={busy}
            onClick={() => void signOut()}
            className="ios-pressable rounded-xl px-2.5 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            {busy ? labels.signingOut : labels.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}
