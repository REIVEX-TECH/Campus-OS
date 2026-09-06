'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { GetVerified } from '@/app/_components/get-verified';
import { refusalMessage } from '@/lib/refusal-message';

export type JoinLabels = {
  join: string;
  leave: string;
  working: string;
  errors: Record<string, string>;
};

/** Join or leave. One POST either way; the page refreshes from the server. */
export function JoinButton({
  tenant,
  communityId,
  joined,
  labels,
}: {
  tenant: string;
  communityId: string;
  joined: boolean;
  labels: JoinLabels;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setWorking(true);
    setError(null);
    setErrorCode(null);
    const response = await fetch(`/api/communities/${communityId}/membership`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action: joined ? 'leave' : 'join' }),
    });
    setWorking(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(refusalMessage(labels.errors, body) || null);
      setErrorCode(body.error ?? null);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={working}
        aria-busy={working || undefined}
        aria-pressed={joined}
        className={buttonVariants({ size: 'sm', variant: joined ? 'outline' : 'default' })}
      >
        {working ? labels.working : joined ? labels.leave : labels.join}
      </button>
      {error ? (
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {errorCode === 'not_verified' ? <GetVerified variant="outline" /> : null}
    </div>
  );
}
