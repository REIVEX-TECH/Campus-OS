'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ComposeSheet } from './compose-sheet';
import { ConversationList } from './conversation-list';
import { ThreadView } from './thread-view';
import type { MessagesLabels } from '@/lib/messages-labels';

/**
 * The full messages surface. On desktop (≥1024px) it is two panes: the list on
 * the left, the selected thread on the right (an empty state when nothing is
 * selected). Below 1024px it is the stacked pattern: the list fills the screen, and
 * selecting a conversation shows the thread full-width with a back link. The active
 * conversation is the `[id]` route param, so deep links work and selecting one is a
 * soft navigation; it lives in the messages layout, so switching does not reload the
 * list. Reuses ConversationList and ThreadView, so no thread logic is duplicated.
 */
export function MessagesScreen({
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
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const [composing, setComposing] = useState(false);
  const activeId = typeof params.id === 'string' ? params.id : null;

  return (
    <div className="flex h-[calc(100svh-var(--topbar-h)-2.5rem)] gap-4">
      <aside
        className={`min-h-0 w-full flex-col overflow-y-auto lg:flex lg:w-80 lg:shrink-0 ${
          activeId ? 'hidden' : 'flex'
        }`}
      >
        <div className="mb-3 flex items-center justify-between px-1">
          <h1 className="text-xl font-bold tracking-tight">{labels.list.messages}</h1>
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="ios-pressable rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
          >
            {labels.widget.newMessage}
          </button>
        </div>
        <ConversationList
          tenant={tenant}
          labels={labels.list}
          requestLabels={labels.request}
          activeId={activeId}
          onSelect={(id) => router.push(`${base}/messages/${id}`)}
        />
      </aside>

      <section className={`min-h-0 flex-1 flex-col ${activeId ? 'flex' : 'hidden lg:flex'}`}>
        {activeId ? (
          <>
            <Link
              href={`${base}/messages`}
              className="mb-2 inline-flex items-center gap-1 px-1 text-sm font-medium text-primary lg:hidden"
            >
              &#8592; {labels.list.messages}
            </Link>
            <ThreadView
              key={activeId}
              tenant={tenant}
              base={base}
              conversationId={activeId}
              selfUserId={selfUserId}
              editWindowMinutes={editWindowMinutes}
              deleteWindowMinutes={deleteWindowMinutes}
              reasons={labels.reasons}
              labels={labels.conversation}
              unknownMemberLabel={labels.list.unknownMember}
              onLeave={() => router.push(`${base}/messages`)}
            />
          </>
        ) : (
          <p className="m-auto text-sm text-muted-foreground">{labels.list.selectConversation}</p>
        )}
      </section>

      <ComposeSheet
        tenant={tenant}
        open={composing}
        onClose={() => setComposing(false)}
        onSent={(id) => {
          setComposing(false);
          router.push(`${base}/messages/${id}`);
        }}
        maxLength={maxLength}
        labels={labels.compose}
      />
    </div>
  );
}
