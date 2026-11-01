import { QUEUES } from '@accordo/shared';

export { QUEUES };

const NOTIFIED = new Set(['listing.price_dropped', 'listing.review_pending', 'listing.approved']);

/** Outbox event type → queues. Events without a route are marked processed (no consumer yet). */
export function routesFor(type: string): string[] {
  const queues: string[] = [];
  if (type.startsWith('media.')) queues.push(QUEUES.media);
  if (
    NOTIFIED.has(type) ||
    type === 'message.created' ||
    type.startsWith('offer.') ||
    type.startsWith('shop.') ||
    type.startsWith('report.') ||
    type.startsWith('moderation.')
  )
    queues.push(QUEUES.notifications);
  if (type === 'webhook.received' || type === 'order.effects' || type === 'dac7.profile_saved')
    queues.push(QUEUES.payments);
  if (type === 'catalog.sync') queues.push(QUEUES.searchIndex);
  if (type === 'dac7.reminder') queues.push(QUEUES.compliance);
  if (type === 'shipping.updates') queues.push(QUEUES.shipping);
  if (type.startsWith('feedback.')) queues.push(QUEUES.reputation);
  // Every listing change may add, update or remove the search document (SPEC §9.3).
  if (type.startsWith('listing.')) queues.push(QUEUES.searchIndex);
  return queues;
}
