'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

/**
 * Grant a member the administrator role by their email.
 *
 * The bootstrap path: after a new university's first person signs in to it once,
 * a platform admin (entered on a grant) or an existing admin finds them by the
 * address they know and grants tenant_admin. Two steps on purpose: find, then
 * confirm the handle before granting, so admin is never granted to the wrong
 * person. The lookup resolves only to a member of this university.
 */
export type GrantByEmailLabels = {
  intro: string;
  email: string;
  find: string;
  finding: string;
  notFound: string;
  foundVerified: string;
  foundUnverified: string;
  alreadyAdmin: string;
  grant: string;
  granting: string;
  granted: string;
  failed: string;
};

type Found = { userId: string; handle: string; isVerified: boolean; roles: string[] };
type State =
  | { kind: 'idle' | 'finding' | 'notFound' }
  | { kind: 'found' | 'granting'; member: Found }
  | { kind: 'granted'; handle: string }
  | { kind: 'error'; message: string };

export function GrantByEmail({ tenant, labels }: { tenant: string; labels: GrantByEmailLabels }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function find(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setState({ kind: 'finding' });
    const res = await fetch('/api/admin/roles/find', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, email: email.trim() }),
    });
    const body = (await res.json().catch(() => ({}))) as { found?: Found | null };
    if (!res.ok) return setState({ kind: 'error', message: labels.failed });
    setState(body.found ? { kind: 'found', member: body.found } : { kind: 'notFound' });
  }

  async function grant(member: Found): Promise<void> {
    setState({ kind: 'granting', member });
    const res = await fetch('/api/admin/roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant,
        userId: member.userId,
        roleKey: 'tenant_admin',
        action: 'grant',
      }),
    });
    if (!res.ok) return setState({ kind: 'error', message: labels.failed });
    setEmail('');
    setState({ kind: 'granted', handle: member.handle });
    router.refresh();
  }

  const busy = state.kind === 'finding' || state.kind === 'granting';
  const showing = state.kind === 'found' || state.kind === 'granting' ? state.member : null;
  const alreadyAdmin = showing?.roles.includes('tenant_admin') ?? false;

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-sm text-muted-foreground">{labels.intro}</p>
      <form onSubmit={find} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{labels.email}</span>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            required
            className="ios-field h-11 w-full max-w-sm rounded-xl px-3.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div>
          <button
            type="submit"
            disabled={busy}
            aria-busy={state.kind === 'finding' || undefined}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            {state.kind === 'finding' ? labels.finding : labels.find}
          </button>
        </div>
      </form>

      {state.kind === 'notFound' ? (
        <p className="max-w-prose text-sm text-muted-foreground" role="status">
          {labels.notFound}
        </p>
      ) : null}

      {showing ? (
        <div className="ios-card flex flex-col gap-2 rounded-xl p-3">
          <p className="text-sm">
            {(showing.isVerified ? labels.foundVerified : labels.foundUnverified).replace(
              '{handle}',
              showing.handle,
            )}
          </p>
          {alreadyAdmin ? (
            <p className="text-sm text-muted-foreground" role="status">
              {labels.alreadyAdmin.replace('{handle}', showing.handle)}
            </p>
          ) : (
            <div>
              <button
                type="button"
                disabled={busy}
                aria-busy={state.kind === 'granting' || undefined}
                onClick={() => grant(showing)}
                className={buttonVariants({ size: 'sm' })}
              >
                {state.kind === 'granting' ? labels.granting : labels.grant}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {state.kind === 'granted' ? (
        <p className="text-sm text-primary" role="status">
          {labels.granted.replace('{handle}', state.handle)}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
