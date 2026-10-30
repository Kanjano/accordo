/** BullMQ queues fed by the outbox dispatcher. */
export const QUEUES = {
  media: 'media',
  notifications: 'notifications',
  lifecycle: 'listing-lifecycle',
} as const;

/** Outbox event type → queue. Events without a route are marked processed (no consumer yet). */
export const ROUTES: Record<string, string> = {
  'media.uploaded': QUEUES.media,
  'media.deleted': QUEUES.media,
  'listing.price_dropped': QUEUES.notifications,
  'listing.review_pending': QUEUES.notifications,
};
