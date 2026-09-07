'use client';

import { useState } from 'react';

/** Toggle a private bookmark on a listing. Optimistic; reverts on failure. */
export function SaveButton({
  tenant,
  listingId,
  initialSaved,
  labels,
}: {
  tenant: string;
  listingId: string;
  initialSaved: boolean;
  labels: { save: string; saved: string };
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !saved;
    setSaved(next);
    setBusy(true);
    const res = await fetch(`/api/marketplace/listings/${listingId}/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action: next ? 'save' : 'unsave' }),
    }).catch(() => undefined);
    setBusy(false);
    if (!res?.ok) setSaved(!next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      disabled={busy}
      className={`ios-pressable inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-medium disabled:opacity-50 ${
        saved ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
      }`}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {saved ? labels.saved : labels.save}
    </button>
  );
}
