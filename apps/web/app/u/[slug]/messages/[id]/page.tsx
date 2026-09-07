import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { thread } from '@campusos/module-messages/service';
import { REPORT_REASONS } from '@campusos/module-messages/moderation';
import { Conversation } from '@/app/_components/messages/conversation';
import { IdentityAvatar } from '@/app/_components/identity-avatar';
import { PageShell } from '@/app/_components/page-shell';
import { currentActor } from '@/lib/auth';
import { translator, type MessageKey } from '@/lib/i18n';
import { messagesSettings, requireMessages } from '@/lib/messages';
import { pageMetadata } from '@/lib/metadata';
import { getTenantRegistry } from '@/lib/tenants';
import { requireTenant } from '@/lib/timetable';
import { tenantBase } from '@/lib/tenant-url';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const tenant = (await getTenantRegistry()).resolveBySlug(slug);
  if (!tenant) return {};
  return pageMetadata({
    tenant,
    title: translator(tenant.locale)('messages.heading'),
    path: `${await tenantBase(slug)}/messages`,
    noIndex: true,
  });
}

export default async function MessageThreadPage({ params }: Params) {
  const { slug, id } = await params;
  const tenant = await requireTenant(slug);
  requireMessages(tenant);
  const t = translator(tenant.locale);
  const base = await tenantBase(slug);
  const actor = await currentActor();
  if (!actor) redirect(`${base}/signin`);

  const convo = await thread(actor, slug, id);
  if (!convo) notFound();
  const settings = messagesSettings(tenant);
  const name = convo.otherHandle ?? t('messages.unknownMember');

  return (
    <PageShell>
      <div className="flex flex-col gap-3">
        <header className="flex items-center gap-3 px-1">
          <Link href={`${base}/messages`} className="text-sm font-medium text-primary">
            {t('messages.back')}
          </Link>
          <div className="ml-1 flex min-w-0 items-center gap-2">
            <IdentityAvatar
              seed={convo.otherAvatarSeed ?? convo.otherUserId}
              label={name}
              size={32}
            />
            {convo.otherHandle ? (
              <Link
                href={`${base}/people/${convo.otherHandle}`}
                className="truncate text-base font-semibold hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span className="truncate text-base font-semibold">{name}</span>
            )}
          </div>
        </header>

        <Conversation
          tenant={slug}
          conversationId={convo.id}
          selfUserId={actor.userId}
          initialMessages={convo.messages.map((m) => ({
            id: m.id,
            senderId: m.senderId,
            body: m.body,
            createdAt: m.createdAt.toISOString(),
            editedAt: m.editedAt ? m.editedAt.toISOString() : null,
            deleted: m.deleted,
          }))}
          otherLastReadAt={convo.otherLastReadAt ? convo.otherLastReadAt.toISOString() : null}
          ephemerality={convo.ephemerality}
          status={convo.status}
          isRequester={convo.isRequester}
          canSend={convo.canSend}
          otherTyping={convo.otherTyping}
          inboxHref={`${base}/messages`}
          editWindowMinutes={settings.editWindowMinutes}
          deleteWindowMinutes={settings.deleteEveryoneWindowMinutes}
          reasons={REPORT_REASONS.map((r) => ({
            key: r,
            label: t(`messages.report.reason.${r}` as MessageKey),
          }))}
          labels={{
            placeholder: t('messages.composer.placeholder'),
            send: t('messages.composer.send'),
            sending: t('messages.composer.sending'),
            you: t('messages.you'),
            edited: t('messages.edited'),
            deleted: t('messages.deleted'),
            read: t('messages.read'),
            edit: t('messages.edit'),
            del: t('messages.delete'),
            report: t('messages.report.button'),
            reportPrompt: t('messages.report.prompt'),
            reportNote: t('messages.report.notePlaceholder'),
            reportSaved: t('messages.report.saved'),
            reportDone: t('messages.report.done'),
            failed: t('messages.failed'),
            empty: t('messages.threadEmpty'),
            ephemeralityLabel: t('messages.ephemerality.label'),
            ephemeralityNever: t('messages.ephemerality.never'),
            ephemeralityAfter24h: t('messages.ephemerality.after24h'),
            ephemeralityAfterViewing: t('messages.ephemerality.afterViewing'),
            requestSent: t('messages.request.sent'),
            requestWaiting: t('messages.request.waiting'),
            requestComposerHint: t('messages.request.replyAccepts'),
            requestIncomingHint: t('messages.request.incoming'),
            accept: t('messages.request.accept'),
            decline: t('messages.request.decline'),
            block: t('messages.request.block'),
            typing: t('messages.typing'),
          }}
        />
      </div>
    </PageShell>
  );
}
