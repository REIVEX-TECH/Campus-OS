'use client';

import { useState } from 'react';

export interface ShareLinkLabels {
  heading: string;
  intro: string;
  create: string;
  creating: string;
  copy: string;
  copied: string;
  revoke: string;
  revoking: string;
  active: string;
  revoked: string;
  failed: string;
}

/** Create, copy, and revoke a bearer share link for a ride. */
export function ShareLink({
  tenant,
  rideId,
  base,
  hasActive,
  labels,
}: {
  tenant: string;
  rideId: string;
  base: string;
  hasActive: boolean;
  labels: ShareLinkLabels;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [active, setActive] = useState(hasActive);
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  async function post(action: 'create' | 'revoke'): Promise<Response | undefined> {
    return fetch(`/api/rides/${rideId}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action }),
    }).catch(() => undefined);
  }

  async function create() {
    setState('working');
    const res = await post('create');
    if (!res?.ok) {
      setState('error');
      return;
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      setState('error');
      return;
    }
    // The raw token lives only in the URL; compose it against the current origin so
    // it works on a tenant subdomain and the path-based dev fallback alike.
    setUrl(`${window.location.origin}${base}/r/${data.token}`);
    setActive(true);
    setCopied(false);
    setState('idle');
  }

  async function revoke() {
    setState('working');
    const res = await post('revoke');
    if (!res?.ok) {
      setState('error');
      return;
    }
    setUrl(null);
    setActive(false);
    setState('idle');
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="ios-card flex flex-col gap-2 rounded-2xl p-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold">{labels.heading}</h2>
        <p className="text-xs text-muted-foreground">{labels.intro}</p>
      </div>

      {url ? (
        <div className="flex flex-col gap-2">
          <input
            readOnly
            value={url}
            aria-label={labels.heading}
            onFocus={(e) => e.currentTarget.select()}
            className="ios-field h-10 w-full rounded-xl px-3.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copy}
              className="ios-pressable rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
            >
              {copied ? labels.copied : labels.copy}
            </button>
            <button
              type="button"
              disabled={state === 'working'}
              onClick={revoke}
              className="ios-pressable rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              {state === 'working' ? labels.revoking : labels.revoke}
            </button>
          </div>
        </div>
      ) : active ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{labels.active}</span>
          <button
            type="button"
            disabled={state === 'working'}
            onClick={revoke}
            className="ios-pressable rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
          >
            {state === 'working' ? labels.revoking : labels.revoke}
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            disabled={state === 'working'}
            onClick={create}
            className="ios-pressable rounded-full bg-muted px-3 py-1 text-xs font-semibold disabled:opacity-50"
          >
            {state === 'working' ? labels.creating : labels.create}
          </button>
        </div>
      )}
      {state === 'error' ? <p className="text-xs text-destructive">{labels.failed}</p> : null}
    </section>
  );
}
