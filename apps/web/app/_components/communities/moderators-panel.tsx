'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { IdentityAvatar } from '@/app/_components/identity-avatar';

export type PanelMember = {
  userId: string;
  handle: string;
  avatarSeed: string;
  /** Community role keys held, without the plain member role. */
  roles: string[];
};

export type ModeratorsLabels = {
  make: string;
  unmake: string;
  makeOwner: string;
  you: string;
  owner: string;
  moderator: string;
  working: string;
  saved: string;
  errors: Record<string, string>;
};

/**
 * Who moderates, and the owner's controls over it. Making someone owner grants
 * them the role and then gives up your own; the server refuses the second step
 * if it would leave no owner, so the community can never be left headless.
 */
export function ModeratorsPanel({
  tenant,
  communityId,
  selfUserId,
  members,
  labels,
}: {
  tenant: string;
  communityId: string;
  selfUserId: string;
  members: PanelMember[];
  labels: ModeratorsLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{
    userId: string;
    message: string;
    error: boolean;
  } | null>(null);

  async function change(
    userId: string,
    roleKey: string,
    action: 'grant' | 'revoke',
  ): Promise<boolean> {
    const response = await fetch(`/api/communities/${communityId}/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, userId, roleKey, action }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setOutcome({
        userId,
        message: labels.errors[body.error ?? ''] ?? labels.errors.failed ?? '',
        error: true,
      });
      return false;
    }
    return true;
  }

  async function run(userId: string, steps: () => Promise<boolean>): Promise<void> {
    setBusy(userId);
    setOutcome(null);
    const ok = await steps();
    setBusy(null);
    if (ok) {
      setOutcome({ userId, message: labels.saved, error: false });
      router.refresh();
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {members.map((m) => {
        const self = m.userId === selfUserId;
        const isOwner = m.roles.includes('community_owner');
        const isMod = m.roles.includes('community_moderator');
        return (
          <li
            key={m.userId}
            className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 p-3"
          >
            <IdentityAvatar seed={m.avatarSeed} label={m.handle} size={32} />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-sm font-medium">
                {m.handle}
                {self ? (
                  <span className="ml-2 text-xs text-muted-foreground">{labels.you}</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {isOwner ? labels.owner : isMod ? labels.moderator : ''}
              </p>
            </div>
            {!self && !isOwner ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-busy={busy === m.userId || undefined}
                  onClick={() =>
                    run(m.userId, () =>
                      change(m.userId, 'community_moderator', isMod ? 'revoke' : 'grant'),
                    )
                  }
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  {busy === m.userId ? labels.working : isMod ? labels.unmake : labels.make}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      m.userId,
                      async () =>
                        (await change(m.userId, 'community_owner', 'grant')) &&
                        (await change(selfUserId, 'community_owner', 'revoke')),
                    )
                  }
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  {labels.makeOwner}
                </button>
              </div>
            ) : null}
            {outcome?.userId === m.userId ? (
              <p
                role="status"
                className={
                  outcome.error
                    ? 'w-full text-xs text-destructive'
                    : 'w-full text-xs text-muted-foreground'
                }
              >
                {outcome.message}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
