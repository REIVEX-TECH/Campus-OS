'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ComposeSheet, type ComposeLabels } from './compose-sheet';

/**
 * Start a conversation with someone from their profile. If one already exists (an
 * active chat or a request in flight) this is a link to it; otherwise it opens the
 * compose sheet with this person fixed as the recipient (a request is created with
 * its first message in one step).
 */
export function MessageButton({
  tenant,
  base,
  userId,
  recipientHandle,
  recipientAvatarSeed,
  existing,
  maxLength,
  label,
  className,
  labels,
}: {
  tenant: string;
  base: string;
  userId: string;
  recipientHandle: string;
  recipientAvatarSeed: string;
  existing: { id: string; status: string } | null;
  maxLength: number;
  label: string;
  className?: string;
  labels: ComposeLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (existing && (existing.status === 'active' || existing.status === 'pending')) {
    return (
      <Link href={`${base}/messages/${existing.id}`} className={className}>
        {label}
      </Link>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      <ComposeSheet
        tenant={tenant}
        open={open}
        onClose={() => setOpen(false)}
        onSent={(id) => router.push(`${base}/messages/${id}`)}
        maxLength={maxLength}
        labels={labels}
        fixedRecipient={{ userId, handle: recipientHandle, avatarSeed: recipientAvatarSeed }}
      />
    </>
  );
}
