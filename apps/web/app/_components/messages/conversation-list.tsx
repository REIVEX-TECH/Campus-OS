'use client';

import { useCallback, useEffect, useState } from 'react';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { RequestCard, type RequestCardLabels } from './request-card';

type WireConversation = {
  id: string;
  otherUserId: string;
  otherHandle: string | null;
  otherAvatarSeed: string | null;
  lastMessagePreview: string | null;
  unread: number;
  outbound: boolean;
  lastMessageAt: string | null;
};
type WireRequest = {
  id: string;
  fromUserId: string;
  fromHandle: string | null;
  fromAvatarSeed: string | null;
  message: string | null;
};
export type WireInbox = { conversations: WireConversation[]; requests: WireRequest[] };

export type ListLabels = {
  messages: string;
  requests: string;
  empty: string;
  requestsEmpty: string;
  unknownMember: string;
  noPreview: string;
  requestSent: string;
  selectConversation: string;
};

/**
 * The conversations list (active chats, then a Requests section with count),
 * fetched from the GET route and polled every 15s while mounted. Selecting a
 * conversation calls `onSelect`; the widget and the two-pane page both use it.
 */
export function ConversationList({
  tenant,
  labels,
  requestLabels,
  onSelect,
  activeId,
  initial,
}: {
  tenant: string;
  labels: ListLabels;
  requestLabels: RequestCardLabels;
  onSelect: (id: string) => void;
  activeId?: string | null;
  initial?: WireInbox;
}) {
  const [data, setData] = useState<WireInbox>(initial ?? { conversations: [], requests: [] });

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/messages?tenant=${encodeURIComponent(tenant)}`)
      .then((r) => (r.ok ? (r.json() as Promise<WireInbox>) : null))
      .catch(() => null);
    if (res) setData(res);
  }, [tenant]);

  useEffect(() => {
    void refetch();
    const timer = setInterval(() => {
      if (!document.hidden) void refetch();
    }, 15000);
    const onFocus = () => {
      if (!document.hidden) void refetch();
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refetch]);

  return (
    <div className="flex flex-col gap-3">
      {data.conversations.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="ios-card flex flex-col rounded-2xl p-1.5">
          {data.conversations.map((c) => {
            const name = c.otherHandle ?? labels.unknownMember;
            const active = c.id === activeId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`ios-pressable flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted ${
                    active ? 'bg-muted' : ''
                  }`}
                >
                  <IdentityAvatar
                    seed={c.otherAvatarSeed ?? c.otherUserId}
                    label={name}
                    size={36}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {c.outbound ? labels.requestSent : (c.lastMessagePreview ?? labels.noPreview)}
                    </span>
                  </div>
                  {c.unread > 0 ? (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      {c.unread > 99 ? '99+' : c.unread}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {data.requests.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {labels.requests} ({data.requests.length})
          </p>
          <ul className="flex flex-col gap-2">
            {data.requests.map((r) => (
              <RequestCard
                key={r.id}
                tenant={tenant}
                request={r}
                labels={requestLabels}
                onChanged={refetch}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
