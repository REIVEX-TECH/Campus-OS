'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

export type SanctionEntry = {
  id: string;
  kind: 'ban' | 'mute';
  handle: string;
  reason: string;
  /** Already formatted, or the "until lifted" label. */
  until: string;
};

export type SanctionLabels = {
  heading: string;
  member: string;
  kind: string;
  ban: string;
  mute: string;
  banHint: string;
  muteHint: string;
  duration: string;
  durations: { day: string; week: string; month: string; forever: string };
  reason: string;
  apply: string;
  applied: string;
  active: string;
  none: string;
  lift: string;
  lifted: string;
  errors: Record<string, string>;
};

const DURATIONS = { day: 60 * 24, week: 60 * 24 * 7, month: 60 * 24 * 30, forever: 0 } as const;
type Duration = keyof typeof DURATIONS;

const field =
  'ios-field h-10 rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Ban or mute a member for a while, and lift what is active. For moderators. */
export function MemberSanctions({
  tenant,
  communityId,
  members,
  sanctions,
  labels,
}: {
  tenant: string;
  communityId: string;
  members: { userId: string; handle: string }[];
  sanctions: SanctionEntry[];
  labels: SanctionLabels;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState(members[0]?.userId ?? '');
  const [kind, setKind] = useState<'ban' | 'mute'>('mute');
  const [duration, setDuration] = useState<Duration>('week');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function send(body: Record<string, unknown>, done: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/communities/${communityId}/mod`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, ...body }),
    });
    setBusy(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage({
        text: labels.errors[data.error ?? ''] ?? labels.errors.failed ?? '',
        error: true,
      });
      return;
    }
    setMessage({ text: done, error: false });
    setReason('');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="ios-card flex flex-col gap-3 rounded-2xl p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!userId) return;
          const minutes = DURATIONS[duration];
          void send(
            {
              action: kind,
              userId,
              reason: reason.trim(),
              ...(minutes ? { minutes } : {}),
            },
            labels.applied,
          );
        }}
      >
        <h2 className="text-sm font-semibold">{labels.heading}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{labels.member}</span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className={field}
              required
            >
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.handle}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{labels.duration}</span>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value as Duration)}
              className={field}
            >
              {(Object.keys(DURATIONS) as Duration[]).map((d) => (
                <option key={d} value={d}>
                  {labels.durations[d]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{labels.kind}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {(['mute', 'ban'] as const).map((k) => (
              <label
                key={k}
                className="flex min-h-10 cursor-pointer items-start gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="radio"
                  name="sanction-kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{k === 'ban' ? labels.ban : labels.mute}</span>
                  <span className="text-xs text-muted-foreground">
                    {k === 'ban' ? labels.banHint : labels.muteHint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{labels.reason}</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
            maxLength={300}
            className={field}
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !userId}
            className={buttonVariants({ size: 'sm', variant: 'destructive' })}
          >
            {labels.apply}
          </button>
          {message ? (
            <p
              role="status"
              className={
                message.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
              }
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {labels.active}
        </h2>
        {sanctions.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">{labels.none}</p>
        ) : (
          <ul className="ios-card flex flex-col rounded-2xl p-2">
            {sanctions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-medium">
                    {s.handle}
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {s.kind === 'ban' ? labels.ban : labels.mute}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.reason} · {s.until}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  onClick={() => send({ action: 'lift', kind: s.kind, id: s.id }, labels.lifted)}
                >
                  {labels.lift}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
