/** BullMQ queues fed by the outbox dispatcher (and by the worker's own schedulers); Bull Board lists them. */
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
  compliance: 'compliance',
} as const;
