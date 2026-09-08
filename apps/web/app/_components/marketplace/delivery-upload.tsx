'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface DeliveryUploadLabels {
  attach: string;
  uploading: string;
  failed: string;
  hint: string;
}

const ACCEPTED = [
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

/** The seller attaches a delivery file to an order, then the page refreshes. */
export function DeliveryUpload({
  tenant,
  orderId,
  labels,
}: {
  tenant: string;
  orderId: string;
  labels: DeliveryUploadLabels;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    setBusy(true);
    setError(false);
    try {
      for (const file of Array.from(list)) {
        const body = new FormData();
        body.set('tenant', tenant);
        body.set('file', file);
        const res = await fetch(`/api/marketplace/orders/${orderId}/files`, {
          method: 'POST',
          body,
        });
        if (!res.ok) {
          setError(true);
          setBusy(false);
          return;
        }
      }
      setBusy(false);
      router.refresh();
    } catch {
      setBusy(false);
      setError(true);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium">{labels.attach}</label>
      <input
        type="file"
        accept={[...ACCEPTED, '.pdf,.zip,.docx,.xlsx,.pptx'].join(',')}
        multiple
        disabled={busy}
        onChange={(e) => onPick(e.target.files)}
        className="text-sm"
      />
      <span className="text-xs text-muted-foreground">{labels.hint}</span>
      {busy ? <span className="text-xs text-muted-foreground">{labels.uploading}</span> : null}
      {error ? <span className="text-xs text-destructive">{labels.failed}</span> : null}
    </div>
  );
}
