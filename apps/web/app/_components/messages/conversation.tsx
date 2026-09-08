'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  clearChat: string;
  clearConfirm: string;
  report: string;
  reportPrompt: string;
  reportNote: string;
  reportSaved: string;
  reportDone: string;
  failed: string;
  empty: string;
  ephemeralityLabel: string;
  ephemeralityNever: string;
  ephemeralityAfter24h: string;
  ephemeralityAfterViewing: string;
  requestSent: string;
  requestWaiting: string;
  requestComposerHint: string;
  requestIncomingHint: string;
  accept: string;
  decline: string;
  block: string;
  typing: string;
  disappearsAfterViewing: string;
  disappearsIn24h: string;
  hiddenAway: string;
  newMessages: string;
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
  ephemerality,
  status,
  isRequester,
  canSend,
  otherTyping,
  inboxHref,
  editWindowMinutes,
  deleteWindowMinutes,
  reasons,
  labels,
  onRefresh,
  onLeave,
}: {
  tenant: string;
  conversationId: string;
  selfUserId: string;
  initialMessages: WireMessage[];
  otherLastReadAt: string | null;
  ephemerality: string;
  status: string;
  isRequester: boolean;
  canSend: boolean;
  otherTyping: boolean;
  inboxHref: string;
  editWindowMinutes: number;
  deleteWindowMinutes: number;
  reasons: Reason[];
  labels: ConversationLabels;
  /** Refresh the thread after an action or poll. Defaults to a route refresh (full
   *  page); a client container (the chat widget) re-fetches instead. */
  onRefresh?: () => void;
  /** Where to go when a request is declined/blocked. Defaults to the inbox; the
   *  widget returns to its list view. */
  onLeave?: () => void;
}) {
  const router = useRouter();
  const refresh = onRefresh ?? (() => router.refresh());
  const leave = onLeave ?? (() => router.push(inboxHref));
  // The poll reads refresh through a ref so a changing onRefresh does not re-arm it.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // A pending request the actor received: they accept/decline it here (or replying
  // accepts). A request the actor sent shows "Request sent" and no composer.
  const incoming = status === 'pending' && !isRequester;
  const sentRequest = (status === 'pending' || status === 'declined') && isRequester;
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // After-viewing: blank the viewed messages the moment the viewer looks away.
  const [hideViewed, setHideViewed] = useState(false);
  // The message list is the only scroll region. These drive follow-to-newest and
  // the "new messages" pill shown when the reader has scrolled up to read history.
  const scrollRef = useRef<HTMLOListElement>(null);
  const atBottomRef = useRef(true);
  const firstScrollRef = useRef(true);
  const prevCountRef = useRef(0);
  const [showPill, setShowPill] = useState(false);
  const lastTypingRef = useRef(0);

  // Typing heartbeat: while the actor types in an ACTIVE chat, refresh their
  // typing_until at most every 2s; clear it on send or blur. A no-op elsewhere.
  function typingHeartbeat() {
    if (status !== 'active') return;
    const now = Date.now();
    if (now - lastTypingRef.current < 2000) return;
    lastTypingRef.current = now;
    void fetch(`/api/messages/${conversationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action: 'typing', on: true }),
    }).catch(() => undefined);
  }
  function clearTyping() {
    if (status !== 'active' || lastTypingRef.current === 0) return;
    lastTypingRef.current = 0;
    void fetch(`/api/messages/${conversationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action: 'typing', on: false }),
    }).catch(() => undefined);
  }

  // The server render is the truth: once it updates, drop the optimistic bubbles.
  useEffect(() => {
    setOptimistic([]);
  }, [initialMessages]);

  // After-viewing only: hide the messages the viewer has seen the moment their
  // attention leaves (tab hidden). Leaving the thread or closing the widget unmounts
  // the component, which removes them outright; this covers looking away in place.
  useEffect(() => {
    if (ephemerality !== 'after_viewing') return;
    const onVis = () => setHideViewed(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [ephemerality]);

  // Mark read on open, poll every 3s while visible, and refresh immediately when
  // the tab regains focus (so new messages and the typing indicator do not wait up
  // to 3s after returning).
  useEffect(() => {
    const post = (body: Record<string, unknown>) =>
      fetch(`/api/messages/${conversationId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, ...body }),
      }).catch(() => undefined);
    void post({ action: 'read' });
    const timer = setInterval(() => {
      if (!document.hidden) refreshRef.current();
    }, 3000);
    const onFocus = () => {
      if (!document.hidden) {
        void post({ action: 'read' });
        refreshRef.current();
      }
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [conversationId, tenant]);

  const scrollToNewest = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowPill(false);
  }, []);

  // Track whether the reader is at the bottom, so a new message can follow only
  // when it should. A small threshold keeps "near the bottom" counting as bottom.
  function onListScroll() {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottomRef.current) setShowPill(false);
  }

  // Follow the newest message on open and when one arrives from either side, but
  // only if the reader is already at the bottom; if they have scrolled up, leave
  // them there and raise the pill instead.
  useEffect(() => {
    const first = firstScrollRef.current;
    const grew = initialMessages.length > prevCountRef.current;
    firstScrollRef.current = false;
    prevCountRef.current = initialMessages.length;
    if (first || atBottomRef.current) scrollToNewest(first ? 'auto' : 'smooth');
    else if (grew) setShowPill(true);
  }, [initialMessages, scrollToNewest]);

  // The reader's own send always follows to the bottom.
  useEffect(() => {
    if (optimistic.length > 0) scrollToNewest('smooth');
  }, [optimistic, scrollToNewest]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setOptimistic((o) => [...o, body]);
    setDraft('');
    clearTyping();
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
        refresh();
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
    void act(m.id, { action: 'edit', body: next }).then((ok) => ok && refresh());
  }

  function del(m: WireMessage) {
    if (!window.confirm(labels.del)) return;
    void act(m.id, { action: 'delete' }).then((ok) => ok && refresh());
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
  // A per-message tag naming how this conversation's messages disappear.
  const ephemeralTag =
    ephemerality === 'after_viewing'
      ? labels.disappearsAfterViewing
      : ephemerality === 'after_24h'
        ? labels.disappearsIn24h
        : null;
  const lastOwn = [...initialMessages]
    .reverse()
    .find((m) => m.senderId === selfUserId && !m.deleted);
  const lastOwnRead = lastOwn ? Date.parse(lastOwn.createdAt) <= lastReadMs : false;

  function changeEphemerality(value: string) {
    void fetch(`/api/messages/${conversationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action: 'ephemerality', value }),
    }).then((res) => {
      if (res.ok) refresh();
      else setError(labels.failed);
    });
  }

  async function requestAction(action: 'accept' | 'decline' | 'decline_block') {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/messages/${conversationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action }),
    }).catch(() => undefined);
    setBusy(false);
    if (res?.ok) {
      // Accept: the thread becomes an active chat here. Decline/block: leave it.
      if (action === 'accept') refresh();
      else leave();
    } else {
      setError(labels.failed);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {status === 'active' ? (
        <label className="flex shrink-0 items-center gap-2 px-1 text-xs text-muted-foreground">
          {labels.ephemeralityLabel}
          <select
            value={ephemerality}
            onChange={(e) => changeEphemerality(e.target.value)}
            className="ios-field h-7 rounded-lg px-2.5 py-0 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="never">{labels.ephemeralityNever}</option>
            <option value="after_24h">{labels.ephemeralityAfter24h}</option>
            <option value="after_viewing">{labels.ephemeralityAfterViewing}</option>
          </select>
        </label>
      ) : null}

      {incoming ? (
        <div className="ios-card flex shrink-0 flex-col gap-2 rounded-2xl p-3">
          <p className="text-sm text-muted-foreground">{labels.requestIncomingHint}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void requestAction('accept')}
              className="ios-pressable rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {labels.accept}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void requestAction('decline')}
              className="ios-pressable rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              {labels.decline}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void requestAction('decline_block')}
              className="ios-pressable rounded-full px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {labels.block}
            </button>
          </div>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ol
          ref={scrollRef}
          onScroll={onListScroll}
          className="ios-card flex flex-1 flex-col gap-2 overflow-y-auto rounded-2xl p-3"
        >
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
                  {m.deleted ? (
                    <span className="italic opacity-70">{labels.deleted}</span>
                  ) : hideViewed && !mine && ephemerality === 'after_viewing' ? (
                    <span className="italic opacity-70">{labels.hiddenAway}</span>
                  ) : (
                    m.body
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                  {ephemeralTag && !m.deleted ? (
                    <span className="inline-flex items-center gap-1 opacity-80">
                      <ClockIcon />
                      {ephemeralTag}
                    </span>
                  ) : null}
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
          {otherTyping ? (
            <li className="px-1 text-xs italic text-muted-foreground">{labels.typing}</li>
          ) : null}
        </ol>
        {showPill ? (
          <button
            type="button"
            onClick={() => scrollToNewest('smooth')}
            className="ios-pressable absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-[var(--shadow-card-strong)]"
          >
            {labels.newMessages}
            <DownIcon />
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="status" className="shrink-0 px-1 text-sm text-muted-foreground">
          {error}
        </p>
      ) : null}

      {sentRequest ? (
        <div className="ios-card flex shrink-0 flex-col gap-0.5 rounded-2xl p-3 text-sm">
          <span className="font-medium">{labels.requestSent}</span>
          <span className="text-muted-foreground">{labels.requestWaiting}</span>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex shrink-0 flex-col gap-1"
        >
          {incoming ? (
            <p className="px-1 text-xs text-muted-foreground">{labels.requestComposerHint}</p>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                typingHeartbeat();
              }}
              onBlur={clearTyping}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={labels.placeholder}
              aria-label={labels.placeholder}
              disabled={!canSend}
              className="ios-field max-h-40 flex-1 resize-none rounded-xl px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !canSend || draft.trim().length === 0}
              className="ios-pressable rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? labels.sending : labels.send}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function DownIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
