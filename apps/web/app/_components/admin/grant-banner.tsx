'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { GrantReasonModal, type GrantModalLabels } from './grant-reason-modal';
import type { GrantBannerLabels } from '@/lib/grant-labels';

/**
 * The always-visible banner while a platform admin is inside a tenant on a
 * grant: which tenant and why, a live countdown, and a way out (close). Under the
 * warning threshold it says so and offers Reopen, which is a fresh, explicitly
 * typed grant (the reason modal), never a silent extension. The active context is
 * never invisible, and there is no silent fallback: the grant is the context.
 */
export function GrantBanner({
  grantId,
  tenantSlug,
  tenantName,
  expiresAt,
  reason,
  warnWithinSeconds,
  labels,
  modalLabels,
}: {
  grantId: string;
  tenantSlug: string;
  tenantName: string;
  expiresAt: string;
  reason: string;
  warnWithinSeconds: number;
  labels: GrantBannerLabels;
  modalLabels: GrantModalLabels;
}) {
  const router = useRouter();
  const expiry = Date.parse(expiresAt);
  // null until mounted, so server and first client render agree (no countdown
  // during SSR); the interval fills it in and ticks once a second.
  const [now, setNow] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [reopen, setReopen] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = now === null ? null : Math.max(0, Math.floor((expiry - now) / 1000));
  const soon = remaining !== null && remaining <= warnWithinSeconds;
  const mmss =
    remaining === null
      ? ''
      : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  async function close(): Promise<void> {
    setClosing(true);
    await fetch('/api/platform/grants/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grantId }),
    });
    router.push('/admin');
  }

  return (
    <div
      role="status"
      className="ios-card mx-auto mt-4 flex w-full max-w-[120rem] flex-col gap-2 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
      style={soon ? { boxShadow: 'inset 0 0 0 2px var(--color-destructive)' } : undefined}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">
          {labels.active.replace('{tenant}', tenantName)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {labels.reason}: {reason}
        </span>
      </div>
      <div className="flex items-center gap-3 sm:ml-auto">
        <span
          className={`text-sm font-medium tabular-nums ${soon ? 'text-destructive' : 'text-foreground'}`}
          suppressHydrationWarning
        >
          {mmss ? labels.timeLeft.replace('{time}', mmss) : ''}
        </span>
        {soon ? (
          <button
            type="button"
            onClick={() => setReopen(true)}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            {labels.reopen}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void close()}
          disabled={closing}
          aria-busy={closing || undefined}
          className={buttonVariants({ size: 'sm', className: 'disabled:opacity-60' })}
        >
          {closing ? labels.closing : labels.close}
        </button>
      </div>
      {soon ? (
        <p className="w-full text-xs text-destructive sm:sr-only" role="alert">
          {labels.expiringSoon}
        </p>
      ) : null}
      <GrantReasonModal
        open={reopen}
        onClose={() => setReopen(false)}
        tenantSlug={tenantSlug}
        tenantName={tenantName}
        previousReason={reason}
        labels={modalLabels}
      />
    </div>
  );
}
