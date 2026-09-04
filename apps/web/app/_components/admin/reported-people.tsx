'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';
import { IdentityAvatar } from '@/app/_components/identity-avatar';

export type ReportedPersonRow = {
  userId: string;
  handle: string;
  avatarSeed: string;
  openReports: number;
  flagged: boolean;
  /** Already translated. */
  reasons: string[];
  /** Already formatted for the locale. */
  when: string;
};

/**
 * Who members have reported, and nothing that was done about it.
 *
 * The queue is a record that people complained, never that anything followed:
 * restricting or suspending is a separate decision, taken and signed on the
 * member list below. Closing the reports says this administrator has looked,
 * so the next one is not reading the same complaint again.
 */
export function ReportedPeople({
  tenant,
  people,
  labels,
}: {
  tenant: string;
  people: ReportedPersonRow[];
  labels: {
    heading: string;
    blurb: string;
    none: string;
    count: string;
    flagged: string;
    dismiss: string;
    acted: string;
    done: string;
    working: string;
    failed: string;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ userId: string; text: string } | null>(null);

  async function close(userId: string, resolution: 'dismissed' | 'acted') {
    setBusy(userId);
    setMessage(null);
    const response = await fetch(`/api/communities/people/${userId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', tenant, resolution }),
    });
    setBusy(null);
    setMessage({ userId, text: response.ok ? labels.done : labels.failed });
    if (response.ok) router.refresh();
  }

  return (
    <section
      aria-labelledby="reported-people"
      className="ios-card flex flex-col gap-3 rounded-2xl p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="reported-people" className="text-base font-semibold tracking-tight">
          {labels.heading}
        </h2>
        <p className="text-xs text-muted-foreground">{labels.blurb}</p>
      </div>

      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {people.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <IdentityAvatar seed={p.avatarSeed} label={p.handle} size={28} />
              <span className="font-medium">{p.handle}</span>
              <span className="text-xs text-muted-foreground">
                {labels.count.replace('{count}', String(p.openReports))}
              </span>
              {p.flagged ? (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                  {labels.flagged}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">{p.reasons.join(', ')}</span>
              <span className="text-xs text-muted-foreground">{p.when}</span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-busy={busy === p.userId || undefined}
                  onClick={() => close(p.userId, 'dismissed')}
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  {busy === p.userId ? labels.working : labels.dismiss}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => close(p.userId, 'acted')}
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  {labels.acted}
                </button>
              </span>
              {message?.userId === p.userId ? (
                <p role="status" className="w-full text-xs text-muted-foreground">
                  {message.text}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
