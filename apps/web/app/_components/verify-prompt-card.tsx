'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GetVerified, type GetVerifiedLabels } from './get-verified';

/**
 * The gentle, dismissible "get verified" card on the tenant home.
 *
 * Shown to a signed-in, unverified member who has not dismissed it. Dismissal is
 * remembered per account on the server, so it never nags again on any device;
 * the card also hides at once (optimistic) while that saves. The page decides
 * whether to render it at all, so a verified person never sees it.
 */
export type VerifyPromptLabels = {
  heading: string;
  body: string;
  dismiss: string;
  getVerified: GetVerifiedLabels;
};

export function VerifyPromptCard({
  tenant,
  labels,
}: {
  tenant: string;
  labels: VerifyPromptLabels;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  async function dismiss(): Promise<void> {
    setDismissed(true);
    await fetch('/api/account/verify-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant }),
    }).catch(() => undefined);
    router.refresh();
  }

  return (
    <section
      aria-labelledby="verify-prompt"
      className="ios-card flex flex-col gap-3 rounded-2xl p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="verify-prompt" className="text-base font-semibold">
            {labels.heading}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">{labels.body}</p>
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label={labels.dismiss}
          className="ios-pressable ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
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
      </div>
      <div>
        <GetVerified tenant={tenant} labels={labels.getVerified} />
      </div>
    </section>
  );
}
