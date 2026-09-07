'use client';

import { useEffect, useRef, useState } from 'react';
import { IdentityAvatar } from '@/app/_components/identity-avatar';

export type ComposeLabels = {
  title: string;
  hint: string;
  placeholder: string;
  send: string;
  sending: string;
  cancel: string;
  failed: string;
  declinedRecently: string;
  blocked: string;
  recipient: string;
  searchPlaceholder: string;
  noMatches: string;
};

type Recipient = { userId: string; handle: string; avatarSeed: string };

/**
 * Compose a new message. A request is created together with its first message in
 * one step (never an empty one). With a `fixedRecipient` (the profile Message
 * button) it skips the picker; otherwise (the widget's "new message") it searches
 * members by handle first. On success it hands back the conversation id.
 */
export function ComposeSheet({
  tenant,
  open,
  onClose,
  onSent,
  maxLength,
  labels,
  fixedRecipient,
}: {
  tenant: string;
  open: boolean;
  onClose: () => void;
  onSent: (conversationId: string) => void;
  maxLength: number;
  labels: ComposeLabels;
  fixedRecipient?: Recipient;
}) {
  const [recipient, setRecipient] = useState<Recipient | null>(fixedRecipient ?? null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Recipient[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Reset when opened; focus the first field.
  useEffect(() => {
    if (!open) return;
    setRecipient(fixedRecipient ?? null);
    setQuery('');
    setMatches([]);
    setDraft('');
    setError(null);
    const raf = requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, fixedRecipient]);

  // Debounced handle search while picking a recipient.
  useEffect(() => {
    if (recipient || !open) return;
    const q = query.trim();
    if (!q) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      void fetch(
        `/api/messages/recipients?tenant=${encodeURIComponent(tenant)}&q=${encodeURIComponent(q)}`,
      )
        .then((r) => (r.ok ? r.json() : { matches: [] }))
        .then((d: { matches?: Recipient[] }) => setMatches(d.matches ?? []))
        .catch(() => setMatches([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, recipient, open, tenant]);

  async function send() {
    const body = draft.trim();
    if (!body || !recipient || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, userId: recipient.userId, body }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.ok && data.id) {
        onSent(data.id);
        return;
      }
      setError(
        data.error === 'declined_recently'
          ? labels.declinedRecently
          : data.error === 'blocked'
            ? labels.blocked
            : labels.failed,
      );
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  const field =
    'ios-field h-10 w-full rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div
      className={`filter-backdrop${open ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={labels.title}
      onClick={() => !busy && onClose()}
    >
      <div className="filter-sheet" onClick={(e) => e.stopPropagation()}>
        <span className="filter-handle" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{labels.title}</h2>
          <p className="text-sm text-muted-foreground">{labels.hint}</p>
        </div>

        {recipient ? (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{labels.recipient}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-sm font-medium">
              <IdentityAvatar seed={recipient.avatarSeed || recipient.userId} label="" size={20} />
              {recipient.handle}
            </span>
            {!fixedRecipient ? (
              <button
                type="button"
                onClick={() => setRecipient(null)}
                className="ios-pressable ml-auto rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                {labels.cancel}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <input
              ref={firstFieldRef as React.RefObject<HTMLInputElement>}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labels.searchPlaceholder}
              aria-label={labels.searchPlaceholder}
              className={field}
            />
            {query.trim() && matches.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">{labels.noMatches}</p>
            ) : null}
            <ul className="flex flex-col">
              {matches.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => setRecipient(m)}
                    className="ios-pressable flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-muted"
                  >
                    <IdentityAvatar seed={m.avatarSeed || m.userId} label={m.handle} size={28} />
                    <span className="text-sm font-medium">{m.handle}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {recipient ? (
          <textarea
            ref={firstFieldRef as React.RefObject<HTMLTextAreaElement>}
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
        ) : null}

        {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="ios-pressable rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !recipient || draft.trim().length === 0}
            className="ios-pressable rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? labels.sending : labels.send}
          </button>
        </div>
      </div>
    </div>
  );
}
