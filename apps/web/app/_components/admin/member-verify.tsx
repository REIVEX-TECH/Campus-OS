'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * Mark a member verified by their public handle, without a request.
 *
 * For the case an admin has checked someone another way. The server does the
 * same as an approval: creates the membership or verifies the one there is,
 * never for the admin themselves.
 */

export type MemberVerifyLabels = {
  handle: string;
  submit: string;
  working: string;
  done: string;
  already: string;
  notFound: string;
  self: string;
  failed: string;
};

type State = { kind: 'idle' | 'working' } | { kind: 'done' | 'error'; message: string };

export function MemberVerify({ tenant, labels }: { tenant: string; labels: MemberVerifyLabels }) {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setState({ kind: 'working' });
    const response = await fetch('/api/admin/members/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, handle: handle.trim() }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      alreadyVerified?: boolean;
    };
    if (!response.ok) {
      const message =
        body.error === 'self'
          ? labels.self
          : body.error === 'no_such_handle'
            ? labels.notFound
            : labels.failed;
      setState({ kind: 'error', message });
      return;
    }
    setState({ kind: 'done', message: body.alreadyVerified ? labels.already : labels.done });
    setHandle('');
    router.refresh();
  }

  const working = state.kind === 'working';

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{labels.handle}</span>
        <input
          name="handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          autoComplete="off"
          required
          className="ios-field h-11 w-full max-w-sm rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={working}
          aria-busy={working || undefined}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          {working ? labels.working : labels.submit}
        </button>
        {state.kind === 'done' || state.kind === 'error' ? (
          <p
            className={
              state.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
            role="status"
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
