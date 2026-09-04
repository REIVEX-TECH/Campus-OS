'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buttonVariants } from '@campusos/ui';

export type OversightEntry = {
  id: string;
  href: string;
  name: string;
  pending: boolean;
  restricted: boolean;
  /** Already translated. */
  members: string;
  openReports: string | null;
};

export type OversightLabels = {
  pending: string;
  restricted: string;
  approve: string;
  approved: string;
  dissolve: string;
  dissolveReason: string;
  dissolved: string;
  confirm: string;
  cancel: string;
  errors: Record<string, string>;
};

const action =
  'ios-pressable inline-flex h-8 items-center rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Every community for the tenant: approve what waits, dissolve with a reason. */
export function OversightList({
  tenant,
  items,
  labels,
}: {
  tenant: string;
  items: OversightEntry[];
  labels: OversightLabels;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((c) => (
        <Row key={c.id} tenant={tenant} item={c} labels={labels} />
      ))}
    </ul>
  );
}

function Row({
  tenant,
  item,
  labels,
}: {
  tenant: string;
  item: OversightEntry;
  labels: OversightLabels;
}) {
  const router = useRouter();
  const [dissolving, setDissolving] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function send(body: Record<string, unknown>, done: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/communities/${item.id}/mod`, {
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
    setDissolving(false);
    router.refresh();
  }

  return (
    <li className="ios-card flex flex-col gap-2 rounded-2xl p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={item.href} className="text-sm font-semibold hover:underline">
          {item.name}
        </Link>
        {item.pending ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {labels.pending}
          </span>
        ) : null}
        {item.restricted ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {labels.restricted}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">{item.members}</span>
        {item.openReports ? (
          <span className="text-xs font-medium text-destructive">{item.openReports}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {item.pending ? (
          <button
            type="button"
            disabled={busy}
            className={action}
            onClick={() => send({ action: 'approveCommunity' }, labels.approved)}
          >
            {labels.approve}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          aria-expanded={dissolving}
          className={`${action} hover:text-destructive`}
          onClick={() => setDissolving((d) => !d)}
        >
          {labels.dissolve}
        </button>
      </div>
      {dissolving ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ action: 'dissolve', reason: reason.trim() }, labels.dissolved);
          }}
        >
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={labels.dissolveReason}
            aria-label={labels.dissolveReason}
            required
            minLength={3}
            maxLength={300}
            className="ios-field h-9 flex-1 rounded-xl px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={buttonVariants({ size: 'sm', variant: 'destructive' })}
            >
              {labels.confirm}
            </button>
            <button
              type="button"
              onClick={() => setDissolving(false)}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              {labels.cancel}
            </button>
          </div>
        </form>
      ) : null}
      {message ? (
        <p
          role="status"
          className={message.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          {message.text}
        </p>
      ) : null}
    </li>
  );
}
