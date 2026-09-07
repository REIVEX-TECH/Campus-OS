'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Conversation, type ConversationLabels } from './conversation';
import { IdentityAvatar } from '@/app/_components/identity-avatar';

type WireMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

export type WireThread = {
  id: string;
  otherUserId: string;
  otherHandle: string | null;
  otherAvatarSeed: string | null;
  otherLastReadAt: string | null;
  ephemerality: string;
  status: string;
  isRequester: boolean;
  canSend: boolean;
  otherTyping: boolean;
  messages: WireMessage[];
};

/**
 * A conversation thread that fetches its own data (for the chat widget and the
 * two-pane page): it loads the thread over the GET route and hands the existing
 * `Conversation` component a re-fetch as its refresh, so the polling logic is not
 * duplicated. Give it a `key={conversationId}` so switching conversations remounts
 * it fresh.
 */
export function ThreadView({
  tenant,
  base,
  conversationId,
  selfUserId,
  editWindowMinutes,
  deleteWindowMinutes,
  reasons,
  labels,
  unknownMemberLabel,
  initial,
  onLeave,
}: {
  tenant: string;
  base: string;
  conversationId: string;
  selfUserId: string;
  editWindowMinutes: number;
  deleteWindowMinutes: number;
  reasons: { key: string; label: string }[];
  labels: ConversationLabels;
  unknownMemberLabel: string;
  initial?: WireThread;
  onLeave: () => void;
}) {
  const [data, setData] = useState<WireThread | null>(initial ?? null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/messages/${conversationId}?tenant=${encodeURIComponent(tenant)}`)
      .then((r) => (r.ok ? (r.json() as Promise<WireThread>) : null))
      .catch(() => null);
    if (res) setData(res);
  }, [conversationId, tenant]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!data) {
    return <p className="m-auto p-6 text-sm text-muted-foreground">{labels.empty}</p>;
  }
  const name = data.otherHandle ?? unknownMemberLabel;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <IdentityAvatar seed={data.otherAvatarSeed ?? data.otherUserId} label={name} size={28} />
        {data.otherHandle ? (
          <Link
            href={`${base}/people/${data.otherHandle}`}
            className="truncate text-sm font-semibold hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate text-sm font-semibold">{name}</span>
        )}
      </div>
      <Conversation
        tenant={tenant}
        conversationId={data.id}
        selfUserId={selfUserId}
        initialMessages={data.messages}
        otherLastReadAt={data.otherLastReadAt}
        ephemerality={data.ephemerality}
        status={data.status}
        isRequester={data.isRequester}
        canSend={data.canSend}
        otherTyping={data.otherTyping}
        inboxHref={`${base}/messages`}
        editWindowMinutes={editWindowMinutes}
        deleteWindowMinutes={deleteWindowMinutes}
        reasons={reasons}
        labels={labels}
        onRefresh={refetch}
        onLeave={onLeave}
      />
    </div>
  );
}
