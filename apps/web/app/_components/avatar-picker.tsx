'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { avatarSrc } from '@/lib/avatar';

/**
 * Choose your avatar.
 *
 * The reader picks from a page of options rather than being handed a random one:
 * shuffle brings the next page, and the same number always draws the same
 * picture, so it is possible to shuffle past one and come back to it. Only the
 * number is sent; the server builds the seed, so a saved avatar is always one of
 * this person's own options.
 *
 * A real modal: focus moves in and is trapped, the page behind goes inert,
 * Escape closes, and focus returns to whatever opened it. The grid is a radio
 * group, so arrow keys move between options and the choice is announced.
 *
 * It is rendered through a portal to <body> rather than where it is written.
 * The button that opens it lives inside <main>, and the modal makes <main>
 * inert; a dialog nested in there would be inert along with everything else,
 * rendered but unfocusable and unclickable. The portal puts it beside <main>
 * instead, which is what makes the inert boundary mean anything.
 */

export type AvatarPickerLabels = {
  title: string;
  intro: string;
  preview: string;
  shuffle: string;
  save: string;
  saving: string;
  cancel: string;
  close: string;
  failed: string;
  option: string;
};

export function AvatarPicker({
  open,
  onClose,
  currentSeed,
  options,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  currentSeed: string;
  /** The first page: option numbers and the seed each one draws. */
  options: { option: number; seed: string }[];
  labels: AvatarPickerLabels;
}) {
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [shown, setShown] = useState(options);
  const [chosen, setChosen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Portals need a DOM; the first client render is the earliest this can happen.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const preview =
    chosen === null ? currentSeed : (shown.find((o) => o.option === chosen)?.seed ?? currentSeed);

  const shuffle = useCallback(async (): Promise<void> => {
    const next = page + 1;
    const response = await fetch(`/api/account/avatar?page=${next}`);
    if (!response.ok) return;
    const body = (await response.json()) as { options: { option: number; seed: string }[] };
    setPage(next);
    setShown(body.options);
    setChosen(null);
  }, [page]);

  // Modal behaviour: the rest of the page is inert while this is open, so focus
  // and the screen reader cursor cannot leave it.
  useEffect(() => {
    if (!open) return;
    const outside = [document.getElementById('main'), document.getElementById('app-topbar')];
    for (const el of outside) el?.setAttribute('inert', '');
    // Marking a subtree inert blurs whatever was focused inside it, and the
    // browser settles that after the current task, so focus is moved on a
    // macrotask rather than a frame: a frame can land first and be undone. The
    // first option takes focus rather than the dialog itself, which is where a
    // reader wants to be anyway.
    const focusFirst = setTimeout(() => {
      const first = groupRef.current?.querySelector<HTMLElement>('[role="radio"]');
      (first ?? dialogRef.current)?.focus();
    }, 0);
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
      setChosen(null);
      setFailed(false);
    }
  }, [open]);

  if (!open || !mounted) return null;

  async function save(): Promise<void> {
    if (chosen === null) return;
    setSaving(true);
    setFailed(false);
    const response = await fetch('/api/account/avatar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ option: chosen }),
    });
    setSaving(false);
    if (!response.ok) {
      setFailed(true);
      return;
    }
    onClose();
    router.refresh();
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
          <img
            src={avatarSrc('person', preview)}
            width={56}
            height={56}
            alt={labels.preview}
            className="shrink-0 rounded-full"
            style={{ backgroundColor: 'var(--color-muted)' }}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={titleId} className="text-base font-semibold">
              {labels.title}
            </h2>
            <p className="text-sm text-muted-foreground">{labels.intro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="ios-pressable ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
          >
            <CloseIcon />
          </button>
        </div>

        <div
          ref={groupRef}
          role="radiogroup"
          aria-label={labels.title}
          className="grid grid-cols-4 gap-2 sm:grid-cols-6"
        >
          {shown.map((o, i) => {
            const selected = chosen === o.option;
            return (
              <button
                key={o.option}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${labels.option} ${i + 1}`}
                // Roving tabindex: one stop for the whole group, arrows move within.
                tabIndex={selected || (chosen === null && i === 0) ? 0 : -1}
                onClick={() => setChosen(o.option)}
                onKeyDown={(e) => {
                  const delta =
                    e.key === 'ArrowRight' || e.key === 'ArrowDown'
                      ? 1
                      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                        ? -1
                        : 0;
                  if (delta === 0) return;
                  e.preventDefault();
                  const next = (i + delta + shown.length) % shown.length;
                  setChosen(shown[next]!.option);
                  const group = e.currentTarget.parentElement;
                  (group?.children[next] as HTMLElement | undefined)?.focus();
                }}
                className={`ios-pressable grid aspect-square place-items-center rounded-2xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <img
                  src={avatarSrc('person', o.seed)}
                  width={48}
                  height={48}
                  alt=""
                  loading="lazy"
                  className="h-full w-full rounded-full"
                />
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void shuffle()}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {labels.shuffle}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={chosen === null || saving}
            aria-busy={saving || undefined}
            className={buttonVariants({ size: 'sm', className: 'disabled:opacity-60' })}
          >
            {saving ? labels.saving : labels.save}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ios-pressable rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {labels.cancel}
          </button>
          {failed ? (
            <p className="text-sm text-destructive" role="status">
              {labels.failed}
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
