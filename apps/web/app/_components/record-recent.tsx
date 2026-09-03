'use client';

import { useEffect } from 'react';
import { writeLocalRecent, type RecentEntry } from '@/lib/recents-local';

/**
 * Note that the current page was viewed. Renders nothing.
 *
 * Mounted by a page that shows a timetable: it writes to the browser's memory
 * at once and, when someone is signed in, tells the server too. The server call
 * is fire and forget; a page must never wait on, or fail because of, a note
 * about itself.
 */
export function RecordRecent({
  tenant,
  entry,
  signedIn,
}: {
  tenant: string;
  entry: Omit<RecentEntry, 'viewedAt'>;
  signedIn: boolean;
}) {
  const { kind, key, label, href } = entry;
  useEffect(() => {
    writeLocalRecent(tenant, { kind, key, label, href, viewedAt: Date.now() });
    if (!signedIn) return;
    void fetch('/api/account/recents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant, kind, key, label, href }),
      keepalive: true,
    }).catch(() => undefined);
  }, [tenant, kind, key, label, href, signedIn]);
  return null;
}
