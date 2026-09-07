'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IdentityAvatar } from '@/app/_components/identity-avatar';

export type RequestCardLabels = {
  accept: string;
  decline: string;
  block: string;
  unknownMember: string;
  noPreview: string;
  failed: string;
};

/**
 * One inbound message request: who it is from, their one message, and the
 * decision. Accept turns it into a chat (it leaves this list); decline hides it;
 * block does both. The list re-renders from the server after each action.
 */
export function RequestCard({
  tenant,
  request,
  labels,
}: {
  tenant: string;
  request: {
    id: string;
    fromHandle: string | null;
    fromAvatarSeed: string | null;
    fromUserId: string;
    message: string | null;
  };
  labels: RequestCardLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const name = request.fromHandle ?? labels.unknownMember;

  async function act(action: 'accept' | 'decline' | 'decline_block') {
    if (busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/messages/${request.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action }),
    }).catch(() => undefined);
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(true);
  }

  return (
    <li className="ios-card flex flex-col gap-2 rounded-2xl p-3">
      <div className="flex items-center gap-3">
        <IdentityAvatar
          seed={request.fromAvatarSeed ?? request.fromUserId}
          label={name}
          size={36}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {request.message ?? labels.noPreview}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act('accept')}
          className="ios-pressable rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {labels.accept}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act('decline')}
          className="ios-pressable rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
        >
          {labels.decline}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act('decline_block')}
          className="ios-pressable rounded-full px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          {labels.block}
        </button>
        {error ? <span className="text-xs text-destructive">{labels.failed}</span> : null}
      </div>
    </li>
  );
}
