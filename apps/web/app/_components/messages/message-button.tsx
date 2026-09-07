'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type MessageComposeLabels = {
  title: string;
  hint: string;
  placeholder: string;
  send: string;
  sending: string;
  cancel: string;
  failed: string;
  declinedRecently: string;
  blocked: string;
};

/**
 * Start a conversation with someone. If one already exists (an active chat or a
 * request in flight), this is just a link to it. Otherwise it opens a small
 * compose sheet: a request is created WITH its first message in one step, so no
 * empty request is ever made.
 */
export function MessageButton({
  tenant,
  base,
  userId,
  existing,
  maxLength,
  label,
  className,
  labels,
}: {
  tenant: string;
  base: string;
  userId: string;
  /** An existing conversation to link to, if any. */
  existing: { id: string; status: string } | null;
  maxLength: number;
  label: string;
  className?: string;
  labels: MessageComposeLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) areaRef.current?.focus();
  }, [open]);

  // A live chat or a request in flight: link straight to the thread (hooks above
  // run unconditionally so this early return is safe).
  if (existing && (existing.status === 'active' || existing.status === 'pending')) {
    return (
      <Link href={`${base}/messages/${existing.id}`} className={className}>
        {label}
      </Link>
    );
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, userId, body }),
      });
      const result = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.ok && result.id) {
        router.push(`${base}/messages/${result.id}`);
        return;
      }
      setError(
        result.error === 'declined_recently'
          ? labels.declinedRecently
          : result.error === 'blocked'
            ? labels.blocked
            : labels.failed,
      );
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      <div
        className={`filter-backdrop${open ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        onClick={() => !busy && setOpen(false)}
      >
        <div className="filter-sheet" onClick={(e) => e.stopPropagation()}>
          <span className="filter-handle" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{labels.title}</h2>
            <p className="text-sm text-muted-foreground">{labels.hint}</p>
          </div>
          <textarea
            ref={areaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={3}
            maxLength={maxLength}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            className="ios-field mt-3 w-full resize-none rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => !busy && setOpen(false)}
              className="ios-pressable rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {labels.cancel}
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || draft.trim().length === 0}
              className="ios-pressable rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? labels.sending : labels.send}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
