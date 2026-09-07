import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { MessagesScreen } from '@/app/_components/messages/messages-screen';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator } from '@/lib/i18n';
import { buildMessagesLabels } from '@/lib/messages-labels';
import { messagesSettings, requireMessages } from '@/lib/messages';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/**
 * The messages surface renders once here, so selecting a conversation (which
 * changes the `[id]` child route) does not reload the list. The child pages carry
 * only their metadata; this layout draws the two-pane / stacked screen. The active
 * conversation is read from the route by the screen itself.
 */
export default async function MessagesLayout({
  params,
  children,
}: Params & { children: ReactNode }) {
  const { slug } = await params;
  const tenant = await requireTenant(slug);
  requireMessages(tenant);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);
  const settings = messagesSettings(tenant);
  const labels = buildMessagesLabels(translator(tenant.locale));

  return (
    <PageShell>
      <MessagesScreen
        tenant={slug}
        base={base}
        selfUserId={actor.userId}
        maxLength={settings.maxBodyLength}
        editWindowMinutes={settings.editWindowMinutes}
        deleteWindowMinutes={settings.deleteEveryoneWindowMinutes}
        labels={labels}
      />
      {/* The child pages render nothing visible; they exist for the route + metadata. */}
      {children}
    </PageShell>
  );
}
