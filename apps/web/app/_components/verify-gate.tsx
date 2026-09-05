'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { VerificationRequestForm, type VerificationFormLabels } from './verification-request-form';

/**
 * One verification modal for the whole tenant, and the trigger to open it.
 *
 * Hosted once by the tenant layout so any control a verification gate stops (a
 * vote arrow, the comment box, the join button, the account page, the home
 * prompt) can open the same modal without carrying it. `needsVerify` says the
 * signed-in viewer is an unverified member, so a control can offer the affordance
 * exactly where it is blocked; a verified person is never given the gate.
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

type Gate = { needsVerify: boolean; openVerify: () => void; buttonLabel: string };

const VerifyGateContext = createContext<Gate | null>(null);

export function useVerifyGate(): Gate | null {
  return useContext(VerifyGateContext);
}

export function VerifyGateProvider({
  tenant,
  needsVerify,
  labels,
  children,
}: {
  tenant: string;
  needsVerify: boolean;
  labels: GetVerifiedLabels;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <VerifyGateContext.Provider
      value={{ needsVerify, openVerify: () => setOpen(true), buttonLabel: labels.button }}
    >
      {children}
      {open ? <VerifyModal tenant={tenant} labels={labels} onClose={() => setOpen(false)} /> : null}
    </VerifyGateContext.Provider>
  );
}

function VerifyModal({
  tenant,
  labels,
  onClose,
}: {
  tenant: string;
  labels: GetVerifiedLabels;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const outside = [document.getElementById('main'), document.getElementById('app-topbar')];
    for (const el of outside) el?.setAttribute('inert', '');
    const focusFirst = setTimeout(() => dialogRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusFirst);
      document.removeEventListener('keydown', onKey);
      for (const el of outside) el?.removeAttribute('inert');
    };
  }, [onClose]);

  if (!mounted) return null;

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
              {labels.heading}
            </h2>
            <p className="text-sm text-muted-foreground">{labels.intro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="ios-pressable ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
          >
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
  );
}
