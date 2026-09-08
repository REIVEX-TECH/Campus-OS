import type { MessageKey } from './i18n';

/**
 * The generic notification kinds other modules emit (through
 * `@campusos/module-notifications`), mapped to the i18n line the inbox renders.
 * Communities notifications keep their own render; these are everything else. A
 * kind not in the map falls back to a neutral line, so a new emitter is never blank.
 */
const KIND_LINE: Record<string, MessageKey> = {
  'lostfound.claim_opened': 'notifications.generic.lostfound.claim_opened',
  'lostfound.claim_message': 'notifications.generic.lostfound.claim_message',
  'lostfound.claim_approved': 'notifications.generic.lostfound.claim_approved',
  'lostfound.claim_denied': 'notifications.generic.lostfound.claim_denied',
  'lostfound.item_resolved': 'notifications.generic.lostfound.item_resolved',
  'marketplace.saved_sold': 'notifications.generic.marketplace.saved_sold',
  'marketplace.saved_price_changed': 'notifications.generic.marketplace.saved_price_changed',
  'marketplace.report_resolved': 'notifications.generic.marketplace.report_resolved',
  'services.order_update': 'notifications.generic.services.order_update',
  'messages.request': 'notifications.generic.messages.request',
  'messages.request_accepted': 'notifications.generic.messages.request_accepted',
};

export function notificationLineKey(kind: string): MessageKey {
  return KIND_LINE[kind] ?? 'notifications.generic.default';
}
