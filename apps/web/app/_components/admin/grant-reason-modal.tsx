'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * The reason modal for entering (or reopening) a platform grant into a tenant.
 *
 * A real modal (portal to <body>, the page behind goes inert, focus trapped,
 * Escape closes) matching the avatar picker. Entering is an explicit, typed act:
 * the reason starts EMPTY and must be at least 12 characters; on a reopen the
 * previous reason is offered as a one-tap "same reason" chip that fills the
 * editable field, never silently prefilled. On success the browser navigates to
 * the tenant's admin, where the seam re-enters the grant.
 */

export type GrantModalLabels = {
  heading: string; // 'Enter {tenant}'
  intro: string;
  reasonField: string;
  reasonHint: string;
  sameReason: string;
  submit: string;
  submitting: string;
  cancel: string;
  failed: string;
  errors: Record<string, string>;
};

const MIN_REASON = 12;

export function GrantReasonModal({
  open,
  onClose,
  tenantSlug,
  tenantName,
  previousReason,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  tenantName: string;
  previousReason?: string;
  labels: GrantModalLabels;
}) {
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const outside = [document.getElementById('main'), document.getElementById('app-topbar')];
    for (const el of outside) el?.setAttribute('inert', '');
    const focusFirst = setTimeout(() => (textRef.current ?? dialogRef.current)?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusFirst);
      document.removeEventListener('keydown', onKey);
      for (const el of outside) el?.removeAttribute('inert');
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setReason('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open || !mounted) return null;

  const heading = labels.heading.replace('{tenant}', tenantName);
  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_REASON;

  async function submit(): Promise<void> {
    if (tooShort) return;
    setSubmitting(true);
    setError(null);
    const response = await fetch('/api/platform/grants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: tenantSlug, reason: trimmed }),
    });
    if (response.ok) {
      onClose();
      router.push(`/u/${tenantSlug}/admin`);
      return;
    }
    setSubmitting(false);
    let code = 'failed';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') code = body.error;
    } catch {
      // fall back to the generic message below
    }
    setError(labels.errors[code] ?? labels.failed);
  }

  return createPortal(
    <div
      className="filter-backdrop is-open"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="filter-sheet flex flex-col gap-4 outline-none"
      >
        <span className="filter-handle" aria-hidden="true" />
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={titleId} className="text-base font-semibold">
              {heading}
            </h2>
            <p className="text-sm text-muted-foreground">{labels.intro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.cancel}
            className="ios-pressable ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
          >
            <CloseIcon />
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{labels.reasonField}</span>
          <textarea
            ref={textRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            className="ios-field w-full rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-xs text-muted-foreground">{labels.reasonHint}</span>
        </label>

        {previousReason ? (
          <div>
            <button
              type="button"
              onClick={() => {
                setReason(previousReason);
                textRef.current?.focus();
              }}
              className="pill-pressable rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground"
            >
              {labels.sameReason}
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={tooShort || submitting}
            aria-busy={submitting || undefined}
            className={buttonVariants({ size: 'sm', className: 'disabled:opacity-60' })}
          >
            {submitting ? labels.submitting : labels.submit}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ios-pressable rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {labels.cancel}
          </button>
          {error ? (
            <p className="text-sm text-destructive" role="status">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
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
