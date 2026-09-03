'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sign out. The session is revoked on the server, so it stops working
 * everywhere immediately rather than only being forgotten by this browser.
 */
export function SignOutButton({ label, working }: { label: string; working: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/session', { method: 'DELETE' });
        router.refresh();
        setBusy(false);
      }}
      className="ios-pressable rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
    >
      {busy ? working : label}
    </button>
  );
}
