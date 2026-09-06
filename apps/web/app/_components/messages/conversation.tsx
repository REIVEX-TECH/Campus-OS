'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type WireMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

type Reason = { key: string; label: string };

export type ConversationLabels = {
  placeholder: string;
  send: string;
  sending: string;
  you: string;
  edited: string;
  deleted: string;
  read: string;
  edit: string;
  del: string;
  report: string;
  reportPrompt: string;
  reportNote: string;
  reportSaved: string;
  reportDone: string;
  failed: string;
  empty: string;
};

/**
 * One conversation: the messages, a composer that sends optimistically, and a
 * light poll that refreshes the server view while the tab is visible. Message
 * actions (edit/delete your own, report someone else's) post and refresh. The
 * server render is the source of truth; an optimistic bubble is dropped as soon
 * as the refresh brings the real one.
 */
export function Conversation({
  tenant,
  conversationId,
  selfUserId,
  initialMessages,
  otherLastReadAt,
  editWindowMinutes,
  deleteWindowMinutes,
  reasons,
  labels,
}: {
  tenant: string;
  conversationId: string;
  selfUserId: string;
  initialMessages: WireMessage[];
  otherLastReadAt: string | null;
  editWindowMinutes: number;
  deleteWindowMinutes: number;
  reasons: Reason[];
  labels: ConversationLabels;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // The server render is the truth: once it updates, drop the optimistic bubbles.
  useEffect(() => {
    setOptimistic([]);
  }, [initialMessages]);

  // Mark read on open, then poll while the tab is visible.
  useEffect(() => {
    const post = (body: Record<string, unknown>) =>
      fetch(`/api/messages/${conversationId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, ...body }),
      }).catch(() => undefined);
    void post({ action: 'read' });
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [conversationId, tenant, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [initialMessages, optimistic]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setOptimistic((o) => [...o, body]);
    setDraft('');
    try {
      const res = await fetch(`/api/messages/${conversationId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, action: 'send', body }),
      });
      if (!res.ok) {
        setOptimistic((o) => o.filter((b) => b !== body));
        setError(labels.failed);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function act(messageId: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/messages/m/${messageId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, ...body }),
    });
    if (!res.ok) setError(labels.failed);
    return res.ok;
  }

  function edit(m: WireMessage) {
    const next = window.prompt(labels.edit, m.body)?.trim();
    if (!next || next === m.body) return;
    void act(m.id, { action: 'edit', body: next }).then((ok) => ok && router.refresh());
  }

  function del(m: WireMessage) {
    if (!window.confirm(labels.del)) return;
    void act(m.id, { action: 'delete' }).then((ok) => ok && router.refresh());
  }

  function report(m: WireMessage) {
    const list = reasons.map((r, i) => `${i + 1}. ${r.label}`).join('\n');
    const pick = window.prompt(`${labels.reportPrompt}\n${list}`);
    const idx = pick ? Number(pick) - 1 : -1;
    if (idx < 0 || idx >= reasons.length) return;
    const note = window.prompt(labels.reportNote)?.trim() || undefined;
    void act(m.id, { action: 'report', reason: reasons[idx]!.key, note }).then((ok) => {
      if (ok) setError(labels.reportDone);
    });
  }

  const now = Date.now();
  const lastReadMs = otherLastReadAt ? Date.parse(otherLastReadAt) : 0;
  const lastOwn = [...initialMessages]
    .reverse()
    .find((m) => m.senderId === selfUserId && !m.deleted);
  const lastOwnRead = lastOwn ? Date.parse(lastOwn.createdAt) <= lastReadMs : false;

  return (
    <div className="flex flex-col gap-3">
      <ol className="ios-card flex min-h-[40vh] flex-col gap-2 rounded-2xl p-3">
        {initialMessages.length === 0 && optimistic.length === 0 ? (
          <li className="m-auto text-sm text-muted-foreground">{labels.empty}</li>
        ) : null}
        {initialMessages.map((m) => {
          const mine = m.senderId === selfUserId;
          const editable =
            mine && !m.deleted && now - Date.parse(m.createdAt) < editWindowMinutes * 60_000;
          const deletable =
            mine && !m.deleted && now - Date.parse(m.createdAt) < deleteWindowMinutes * 60_000;
          return (
            <li key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}
              >
                {m.deleted ? <span className="italic opacity-70">{labels.deleted}</span> : m.body}
              </div>
              <div className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                {m.editedAt && !m.deleted ? <span>{labels.edited}</span> : null}
                {editable ? (
                  <button type="button" onClick={() => edit(m)} className="hover:underline">
                    {labels.edit}
                  </button>
                ) : null}
                {deletable ? (
                  <button type="button" onClick={() => del(m)} className="hover:underline">
                    {labels.del}
                  </button>
                ) : null}
                {!mine && !m.deleted ? (
                  <button type="button" onClick={() => report(m)} className="hover:underline">
                    {labels.report}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
        {optimistic.map((body, i) => (
          <li key={`opt-${i}`} className="flex flex-col items-end opacity-60">
            <div className="max-w-[80%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
              {body}
            </div>
          </li>
        ))}
        {lastOwnRead ? (
          <li className="px-1 text-right text-[11px] text-muted-foreground">{labels.read}</li>
        ) : null}
        <div ref={endRef} />
      </ol>

      {error ? (
        <p role="status" className="px-1 text-sm text-muted-foreground">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          className="ios-field max-h-40 flex-1 resize-none"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? labels.sending : labels.send}
        </button>
      </form>
    </div>
  );
}
