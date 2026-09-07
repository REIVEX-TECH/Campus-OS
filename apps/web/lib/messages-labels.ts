import { REPORT_REASONS } from '@campusos/module-messages/moderation';
import type { ConversationLabels } from '@/app/_components/messages/conversation';
import type { RequestCardLabels } from '@/app/_components/messages/request-card';
import type { MessageKey, Translate } from './i18n';

type T = Translate;

/** Report-reason options for the thread's report action. */
export function reportReasons(t: T): { key: string; label: string }[] {
  return REPORT_REASONS.map((r) => ({
    key: r,
    label: t(`messages.report.reason.${r}` as MessageKey),
  }));
}

export function conversationLabels(t: T): ConversationLabels {
  return {
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
  };
}

export function requestCardLabels(t: T): RequestCardLabels {
  return {
    accept: t('messages.request.accept'),
    decline: t('messages.request.decline'),
    block: t('messages.request.block'),
    unknownMember: t('messages.unknownMember'),
    noPreview: t('messages.noPreview'),
    failed: t('messages.failed'),
  };
}

export function composeLabels(t: T) {
  return {
    title: t('messages.compose.title'),
    hint: t('messages.compose.hint'),
    placeholder: t('messages.composer.placeholder'),
    send: t('messages.composer.send'),
    sending: t('messages.composer.sending'),
    cancel: t('comments.cancel'),
    failed: t('messages.failed'),
    declinedRecently: t('messages.compose.declinedRecently'),
    blocked: t('messages.compose.blocked'),
    recipient: t('messages.compose.recipient'),
    searchPlaceholder: t('messages.compose.searchPlaceholder'),
    noMatches: t('messages.compose.noMatches'),
  };
}

export function listLabels(t: T) {
  return {
    messages: t('messages.tab.messages'),
    requests: t('messages.tab.requests'),
    empty: t('messages.empty'),
    requestsEmpty: t('messages.requestsEmpty'),
    unknownMember: t('messages.unknownMember'),
    noPreview: t('messages.noPreview'),
    requestSent: t('messages.request.sent'),
    selectConversation: t('messages.selectConversation'),
  };
}

export function widgetLabels(t: T) {
  return {
    chats: t('messages.widget.chats'),
    newMessage: t('messages.widget.newMessage'),
    openFull: t('messages.widget.openFull'),
    minimize: t('messages.widget.minimize'),
    close: t('messages.widget.close'),
    back: t('messages.widget.back'),
    label: t('messages.widget.label'),
  };
}

/** Everything the client messages surface (widget and two-pane) needs, built once. */
export interface MessagesLabels {
  conversation: ConversationLabels;
  request: RequestCardLabels;
  reasons: { key: string; label: string }[];
  compose: ReturnType<typeof composeLabels>;
  list: ReturnType<typeof listLabels>;
  widget: ReturnType<typeof widgetLabels>;
}

export function buildMessagesLabels(t: T): MessagesLabels {
  return {
    conversation: conversationLabels(t),
    request: requestCardLabels(t),
    reasons: reportReasons(t),
    compose: composeLabels(t),
    list: listLabels(t),
    widget: widgetLabels(t),
  };
}
