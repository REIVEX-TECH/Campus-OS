'use client';

import { useState } from 'react';

export type VoteLabels = { up: string; down: string; errors: Record<string, string> };

/**
 * The vote column of a post card: up, score, down. One POST per change; the
 * server keeps one row per person and answers with the tallies, which replace
 * the optimistic numbers. Signed out, the arrows are shown and do nothing but
 * explain themselves.
 */
export function VoteColumn({
  tenant,
  postId,
  score,
  myVote,
  canVote,
  labels,
}: {
  tenant: string;
  postId: string;
  score: number;
  myVote: -1 | 0 | 1;
  canVote: boolean;
  labels: VoteLabels;
}) {
  const [state, setState] = useState({ score, myVote });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function vote(next: -1 | 1): Promise<void> {
    if (!canVote || busy) return;
    const value = state.myVote === next ? 0 : next;
    const before = state;
    setState({ score: state.score - state.myVote + value, myVote: value });
    setError(null);
    setBusy(true);
    const response = await fetch(`/api/communities/posts/${postId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action: 'vote', value }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setState(before);
      setError(labels.errors[body.error ?? ''] ?? labels.errors.failed ?? null);
      return;
    }
    const tally = (await response.json()) as { score: number };
    setState((s) => ({ ...s, score: tally.score }));
  }

  const arrow = (dir: 'up' | 'down', active: boolean) => (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`size-5 ${active ? 'text-primary' : 'text-muted-foreground'}`}
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      {dir === 'up' ? <path d="M10 4l6 7h-4v5H8v-5H4z" /> : <path d="M10 16l-6-7h4V4h4v5h4z" />}
    </svg>
  );

  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-0.5 pt-1" aria-live="polite">
      <button
        type="button"
        onClick={() => vote(1)}
        aria-label={labels.up}
        aria-pressed={state.myVote === 1}
        disabled={!canVote}
        className="ios-pressable inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted disabled:cursor-default disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {arrow('up', state.myVote === 1)}
      </button>
      <span className="text-sm font-semibold tabular-nums">{state.score}</span>
      <button
        type="button"
        onClick={() => vote(-1)}
        aria-label={labels.down}
        aria-pressed={state.myVote === -1}
        disabled={!canVote}
        className="ios-pressable inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted disabled:cursor-default disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {arrow('down', state.myVote === -1)}
      </button>
      {error ? <span className="sr-only">{error}</span> : null}
    </div>
  );
}
