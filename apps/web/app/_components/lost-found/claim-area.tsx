'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GetVerified } from '@/app/_components/get-verified';

export interface ClaimLabels {
  button: string;
  intro: string;
  messagePlaceholder: string;
  open: string;
  opening: string;
  claimsHeading: string;
  noClaims: string;
  yourClaim: string;
  confirm: string;
  reject: string;
  withdraw: string;
  working: string;
  thread: string;
  send: string;
  sending: string;
  resolvedNote: string;
  notVerified: string;
  failed: string;
  status: Record<string, string>;
}

export interface ClaimView {
  id: string;
  claimantHandle: string | null;
  status: string;
  message: string;
  isOwn: boolean;
}

export interface ThreadMessage {
  id: string;
  senderHandle: string | null;
  body: string;
  isOwn: boolean;
}

async function post(url: string, body: unknown): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function ClaimArea({
  base,
  tenant,
  itemId,
  itemStatus,
  isReporter,
  canClaim,
  needsVerify,
  claims,
  selectedClaimId,
  thread,
  labels,
}: {
  base: string;
  tenant: string;
  itemId: string;
  itemStatus: string;
  isReporter: boolean;
  canClaim: boolean;
  needsVerify: boolean;
  claims: ClaimView[];
  selectedClaimId: string | null;
  thread: ThreadMessage[];
  labels: ClaimLabels;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await fn();
    setBusy(false);
    if (ok) router.refresh();
    else setError(labels.failed);
  }

  const itemPath = `${base}/lost-found/${itemId}`;

  return (
    <section className="flex flex-col gap-3">
      {itemStatus === 'resolved' ? (
        <p className="text-sm font-medium text-primary">{labels.resolvedNote}</p>
      ) : null}

      {canClaim ? (
        <form
          className="ios-card flex flex-col gap-2 rounded-2xl p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const res = await fetch('/api/lost-found/claims', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ tenant, itemId, message }),
              });
              return res.ok;
            });
          }}
        >
          <p className="text-sm text-muted-foreground">{labels.intro}</p>
          <textarea
            className="ios-field min-h-20"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={labels.messagePlaceholder}
            maxLength={2000}
            required
          />
          <div>
            <button
              type="submit"
              disabled={busy || message.trim().length < 3}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? labels.opening : labels.open}
            </button>
          </div>
        </form>
      ) : null}

      {needsVerify ? (
        <div className="ios-card flex flex-col items-start gap-2 rounded-2xl p-4">
          <p className="text-sm text-muted-foreground">{labels.notVerified}</p>
          <GetVerified />
        </div>
      ) : null}

      {claims.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold">{labels.claimsHeading}</h2>
          {claims.map((claim) => {
            const selected = claim.id === selectedClaimId;
            return (
              <div key={claim.id} className="ios-card flex flex-col gap-2 rounded-2xl p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {claim.isOwn ? labels.yourClaim : (claim.claimantHandle ?? '?')}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {labels.status[claim.status] ?? claim.status}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{claim.message}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {isReporter && claim.status === 'pending' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            post(`/api/lost-found/claims/${claim.id}`, {
                              tenant,
                              action: 'confirm',
                            }),
                          )
                        }
                        className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        {busy ? labels.working : labels.confirm}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            post(`/api/lost-found/claims/${claim.id}`, {
                              tenant,
                              action: 'reject',
                            }),
                          )
                        }
                        className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
                      >
                        {labels.reject}
                      </button>
                    </>
                  ) : null}
                  {claim.isOwn && claim.status === 'pending' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          post(`/api/lost-found/claims/${claim.id}`, {
                            tenant,
                            action: 'withdraw',
                          }),
                        )
                      }
                      className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
                    >
                      {labels.withdraw}
                    </button>
                  ) : null}
                  <Link
                    href={selected ? itemPath : `${itemPath}?claim=${claim.id}`}
                    scroll={false}
                    className="text-xs font-medium text-primary"
                  >
                    {labels.thread}
                  </Link>
                </div>

                {selected ? (
                  <div className="flex flex-col gap-2 border-t border-black/5 pt-2 dark:border-white/10">
                    {thread.map((m) => (
                      <div key={m.id} className={m.isOwn ? 'text-right' : ''}>
                        <p className="text-[11px] text-muted-foreground">
                          {m.isOwn ? labels.yourClaim : (m.senderHandle ?? '?')}
                        </p>
                        <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                      </div>
                    ))}
                    <form
                      className="flex items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          const ok = await post(`/api/lost-found/claims/${claim.id}`, {
                            tenant,
                            action: 'message',
                            body: reply,
                          });
                          if (ok) setReply('');
                          return ok;
                        });
                      }}
                    >
                      <input
                        className="ios-field flex-1"
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder={labels.send}
                        maxLength={2000}
                      />
                      <button
                        type="submit"
                        disabled={busy || reply.trim().length < 1}
                        className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        {busy ? labels.sending : labels.send}
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : isReporter && itemStatus === 'open' ? (
        <p className="px-1 text-sm text-muted-foreground">{labels.noClaims}</p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
