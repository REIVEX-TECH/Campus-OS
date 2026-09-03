'use client';

import { useRef, useState } from 'react';
import { IdentityAvatar } from './identity-avatar';
import { AvatarPicker, type AvatarPickerLabels } from './avatar-picker';

/**
 * The avatar on the account page, and the way in to changing it.
 *
 * A button rather than a picture, because it does something: it opens the
 * picker. Focus returns here when the picker closes, so a keyboard reader is put
 * back where they were.
 */
export function AccountAvatarButton({
  seed,
  handle,
  options,
  labels,
}: {
  seed: string;
  handle: string;
  options: { option: number; seed: string }[];
  labels: AvatarPickerLabels & { change: string };
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function close(): void {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={labels.change}
        title={labels.change}
        className="ios-pressable shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <IdentityAvatar seed={seed} label={handle} size={56} />
      </button>
      <AvatarPicker
        open={open}
        onClose={close}
        currentSeed={seed}
        options={options}
        labels={labels}
      />
    </>
  );
}
