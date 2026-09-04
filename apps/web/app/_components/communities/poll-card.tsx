'use client';

import { useState } from 'react';
import { buttonVariants } from '@campusos/ui';

export type PollData = {
  options: { id: string; text: string; votes: number; share: number }[];
  total: number;
  closed: boolean;
  myOptionId: string | null;
};

export type PollLabels = {
  vote: string;
  /** "{count}" is replaced. */
  votes: string;
  votesOne: string;
  /** Already resolved: "Closes in 2 days" or "Closed". */
  closesLine: string;
  yours: string;
  cannotVote: string | null;
  errors: Record<string, string>;
};

/**
 * A poll on its post: the options as a choice while the viewer may still vote,
 * the results as bars once they have or once it closed. The vote is one POST;
 * the server answers with the poll as it now stands.
 */
export function PollCard({
  tenant,
  postId,
  poll: initial,
  canVote,
  labels,
}: {
  tenant: string;
  postId: string;
  poll: PollData;
  canVote: boolean;
  labels: PollLabels;
}) {
  const [poll, setPoll] = useState(initial);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showResults = poll.closed || poll.myOptionId !== null || !canVote;

  async function vote(): Promise<void> {
    if (!choice) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/communities/posts/${postId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, action: 'pollVote', optionId: choice }),
    });
    setBusy(false);
    const data = (await response.json().catch(() => ({}))) as PollData & { error?: string };
    if (!response.ok) {
      setError(labels.errors[data.error ?? ''] ?? labels.errors.failed ?? '');
      return;
    }
    setPoll({
      options: data.options,
      total: data.total,
      closed: data.closed,
      myOptionId: data.myOptionId,
    });
  }

  const count =
    poll.total === 1 ? labels.votesOne : labels.votes.replace('{count}', String(poll.total));

  return (
    <section
      aria-label="Poll"
      className="ios-card flex flex-col gap-3 rounded-2xl p-4"
      data-poll-state={showResults ? 'results' : 'open'}
    >
      {showResults ? (
        <ol className="flex flex-col gap-2">
          {poll.options.map((o) => {
            const mine = o.id === poll.myOptionId;
            return (
              <li key={o.id} className="relative overflow-hidden rounded-xl bg-muted/50">
                <div
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 rounded-xl ${mine ? 'bg-primary/20' : 'bg-muted'}`}
                  style={{ width: `${Math.max(o.share, 2)}%` }}
                />
                <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className={mine ? 'font-semibold' : ''}>
                    {o.text}
                    {mine ? (
                      <span className="ml-2 text-xs font-medium text-primary">{labels.yours}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">{o.share}%</span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void vote();
          }}
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">{labels.vote}</legend>
            {poll.options.map((o) => (
              <label
                key={o.id}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm hover:bg-muted"
              >
                <input
                  type="radio"
                  name={`poll-${postId}`}
                  value={o.id}
                  checked={choice === o.id}
                  onChange={() => setChoice(o.id)}
                  className="size-4 accent-primary"
                />
                {o.text}
              </label>
            ))}
          </fieldset>
          <div>
            <button
              type="submit"
              disabled={busy || !choice}
              className={buttonVariants({ size: 'sm' })}
            >
              {labels.vote}
            </button>
          </div>
        </form>
      )}
      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{count}</span>
        <span>·</span>
        <span>{labels.closesLine}</span>
        {!canVote && !poll.closed && labels.cannotVote ? (
          <>
            <span>·</span>
            <span>{labels.cannotVote}</span>
          </>
        ) : null}
      </p>
      {error ? (
        <p role="status" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
