/** BullMQ queues fed by the outbox dispatcher (and by the worker's own schedulers). */
export const QUEUES = {
  media: 'media',
  notifications: 'notifications',
  lifecycle: 'listing-lifecycle',
  searchIndex: 'search-index',
  savedSearchAlerts: 'saved-search-alerts',
  offers: 'offers',
  payments: 'payments',
  orders: 'order-sweeper',
  nightly: 'nightly-checks',
  shipping: 'shipping',
  reputation: 'reputation',
} as const;

const NOTIFIED = new Set(['listing.price_dropped', 'listing.review_pending']);

/** Outbox event type → queues. Events without a route are marked processed (no consumer yet). */
export function routesFor(type: string): string[] {
  const queues: string[] = [];
  if (type.startsWith('media.')) queues.push(QUEUES.media);
  if (NOTIFIED.has(type) || type === 'message.created' || type.startsWith('offer.'))
    queues.push(QUEUES.notifications);
  if (type === 'webhook.received' || type === 'order.effects') queues.push(QUEUES.payments);
  if (type === 'shipping.updates') queues.push(QUEUES.shipping);
  if (type.startsWith('feedback.')) queues.push(QUEUES.reputation);
  // Every listing change may add, update or remove the search document (SPEC §9.3).
  if (type.startsWith('listing.')) queues.push(QUEUES.searchIndex);
  return queues;
}
