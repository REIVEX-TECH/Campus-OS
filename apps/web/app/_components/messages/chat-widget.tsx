'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useChatWidget } from './chat-widget-context';
import { ComposeSheet } from './compose-sheet';
import { ConversationList } from './conversation-list';
import { ThreadView } from './thread-view';
import type { MessagesLabels } from '@/lib/messages-labels';

/**
 * The floating chat widget (desktop only). A non-modal complementary panel anchored
 * bottom-right that the top-bar mail icon toggles; it persists across navigation via
 * the context. Two views (list and thread) with a back arrow. It reuses
 * ConversationList and ThreadView, so nothing here duplicates thread or list logic.
 * Its children mount only while the panel is open, so polling runs only then.
 */
export function ChatWidget({
  tenant,
  base,
  selfUserId,
  maxLength,
  editWindowMinutes,
  deleteWindowMinutes,
  labels,
}: {
  tenant: string;
  base: string;
  selfUserId: string;
  maxLength: number;
  editWindowMinutes: number;
  deleteWindowMinutes: number;
  labels: MessagesLabels;
}) {
  const widget = useChatWidget();
  const [desktop, setDesktop] = useState(false);
  const [composing, setComposing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const open = Boolean(widget?.open) && desktop;

  // Focus into the panel on open; Escape closes; focus returns to the trigger.
  useEffect(() => {
    if (!open || !widget) return;
    const raf = requestAnimationFrame(() => panelRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        widget.minimize();
        document.getElementById('messages-widget-trigger')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, widget]);

  if (!widget || !open) return null;

  const inThread = widget.view === 'thread' && widget.activeId;
  const fullHref = inThread ? `${base}/messages/${widget.activeId}` : `${base}/messages`;
  const closeAndReturn = () => {
    widget.close();
    document.getElementById('messages-widget-trigger')?.focus();
  };

  return (
    <>
      <section
        ref={panelRef}
        tabIndex={-1}
        role="complementary"
        aria-label={labels.widget.label}
        data-print-hide
        className="ios-card fixed bottom-4 right-4 z-40 flex h-[540px] max-h-[calc(100svh-5rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-card-strong)] outline-none"
      >
        <header className="flex items-center gap-1 px-3 py-2">
          {inThread ? (
            <button
              type="button"
              onClick={() => widget.back()}
              aria-label={labels.widget.back}
              className="ios-pressable -ml-1 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <BackIcon />
            </button>
          ) : null}
          <h2 className="flex-1 truncate px-1 text-sm font-semibold">{labels.widget.chats}</h2>
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label={labels.widget.newMessage}
            className="ios-pressable grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PencilIcon />
          </button>
          <Link
            href={fullHref}
            aria-label={labels.widget.openFull}
            className="ios-pressable grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExpandIcon />
          </Link>
          <button
            type="button"
            onClick={() => widget.minimize()}
            aria-label={labels.widget.minimize}
            className="ios-pressable grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            onClick={closeAndReturn}
            aria-label={labels.widget.close}
            className="ios-pressable grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          {inThread ? (
            <ThreadView
              key={widget.activeId}
              tenant={tenant}
              base={base}
              conversationId={widget.activeId!}
              selfUserId={selfUserId}
              editWindowMinutes={editWindowMinutes}
              deleteWindowMinutes={deleteWindowMinutes}
              reasons={labels.reasons}
              labels={labels.conversation}
              unknownMemberLabel={labels.list.unknownMember}
              onLeave={() => widget.back()}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConversationList
                tenant={tenant}
                labels={labels.list}
                requestLabels={labels.request}
                onSelect={(id) => widget.openThread(id)}
              />
            </div>
          )}
        </div>
      </section>

      <ComposeSheet
        tenant={tenant}
        open={composing}
        onClose={() => setComposing(false)}
        onSent={(id) => {
          setComposing(false);
          widget.openThread(id);
        }}
        maxLength={maxLength}
        labels={labels.compose}
      />
    </>
  );
}

function BackIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function ExpandIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6M21 3l-9 9M10 3H3v18h18v-7" />
    </svg>
  );
}
function MinimizeIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg
      className="h-4 w-4"
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
