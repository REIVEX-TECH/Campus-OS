'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ModuleIcon } from '@/app/_components/module-icon';
import type { ModuleIconName } from '@/lib/modules';

/**
 * A contextual nudge on the tenant home: an icon, a line about a module worth a first
 * action, and a single CTA. Deliberately not a post: it is accent-tinted with a soft
 * border rather than an ios-card, so it reads as a prompt from the app, not as content
 * a person wrote. Dismissal is per card per account on the server (hidden for 24h) and
 * also hides the card at once (optimistic) while that saves. The page decides which
 * cards to render, so a dismissed one does not come back the same day.
 */
export type ContextualCardLabels = {
  title: string;
  body: string;
  cta: string;
  dismiss: string;
};

export function ContextualCard({
  tenant,
  cardId,
  href,
  icon,
  labels,
}: {
  tenant: string;
  cardId: string;
  href: string;
  icon: ModuleIconName;
  labels: ContextualCardLabels;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  async function dismiss(): Promise<void> {
    setDismissed(true);
    await fetch('/api/account/card/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, card: cardId }),
    }).catch(() => undefined);
    router.refresh();
  }

  return (
    <section
      aria-labelledby={`card-${cardId}`}
      className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <ModuleIcon name={icon} className="h-5 w-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id={`card-${cardId}`} className="text-base font-semibold">
          {labels.title}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{labels.body}</p>
        <Link
          href={href}
          className="mt-2 inline-flex w-fit items-center text-sm font-semibold text-primary hover:underline"
        >
          {labels.cta}
        </Link>
      </div>
      <button
        type="button"
        onClick={() => void dismiss()}
        aria-label={labels.dismiss}
        className="ios-pressable grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
      >
        <svg
          className="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </section>
  );
}
