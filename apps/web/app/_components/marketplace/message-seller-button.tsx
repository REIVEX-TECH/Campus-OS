'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ComposeSheet, type ComposeLabels } from '@/app/_components/messages/compose-sheet';

/**
 * Contact the seller through the messages module. Opens the compose sheet with the
 * seller fixed as the recipient and the listing title + link prefilled as the first
 * line, so the seller knows which listing the message is about. If a conversation
 * already exists, the module lands the message into it.
 */
export function MessageSellerButton({
  tenant,
  base,
  sellerId,
  sellerHandle,
  sellerAvatarSeed,
  listingTitle,
  listingPath,
  maxLength,
  label,
  labels,
}: {
  tenant: string;
  base: string;
  sellerId: string;
  sellerHandle: string;
  sellerAvatarSeed: string;
  listingTitle: string;
  listingPath: string;
  maxLength: number;
  label: string;
  labels: ComposeLabels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initialDraft = `${listingTitle}\n${base}${listingPath}\n\n`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ios-pressable inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
      >
        {label}
      </button>
      <ComposeSheet
        tenant={tenant}
        open={open}
        onClose={() => setOpen(false)}
        onSent={(id) => router.push(`${base}/messages/${id}`)}
        maxLength={maxLength}
        labels={labels}
        fixedRecipient={{ userId: sellerId, handle: sellerHandle, avatarSeed: sellerAvatarSeed }}
        initialDraft={initialDraft}
      />
    </>
  );
}
