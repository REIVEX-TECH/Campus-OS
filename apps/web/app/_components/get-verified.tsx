'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buttonVariants } from '@campusos/ui';
import { VerificationRequestForm, type VerificationFormLabels } from './verification-request-form';

/**
 * The one "Get verified" button and the modal it opens, used from the account
 * page, the home prompt, and the walls a verification gate stops someone at.
 *
 * A real modal (portal to <body>, the page behind goes inert, focus trapped,
 * Escape closes) matching the grant modal and avatar picker. It explains what
 * verification unlocks and the two ways to get it, then carries the existing
 * request form. Requesting is a deliberate act taken from here, never an
 * always-open form.
 */
export type GetVerifiedLabels = {
  button: string;
  heading: string;
  intro: string;
  howHeading: string;
  howDomain: string;
  howRequest: string;
  close: string;
  form: VerificationFormLabels;
};

export function GetVerified({
  tenant,
  labels,
  variant = 'default',
}: {
  tenant: string;
  labels: GetVerifiedLabels;
  variant?: 'default' | 'outline';
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const outside = [document.getElementById('main'), document.getElementById('app-topbar')];
    for (const el of outside) el?.setAttribute('inert', '');
    const focusFirst = setTimeout(() => dialogRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusFirst);
      document.removeEventListener('keydown', onKey);
      for (const el of outside) el?.removeAttribute('inert');
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ size: 'sm', variant })}
      >
        {labels.button}
      </button>
      {open && mounted
        ? createPortal(
            <div
              className="filter-backdrop is-open"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
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
                      {labels.heading}
                    </h2>
                    <p className="text-sm text-muted-foreground">{labels.intro}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label={labels.close}
                    className="ios-pressable ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <CloseIcon />
                  </button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-semibold">{labels.howHeading}</h3>
                  <p className="text-sm text-muted-foreground">{labels.howDomain}</p>
                  <p className="text-sm text-muted-foreground">{labels.howRequest}</p>
                </div>

                <VerificationRequestForm tenant={tenant} labels={labels.form} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
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
