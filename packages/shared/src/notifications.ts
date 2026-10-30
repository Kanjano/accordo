import { z } from 'zod';

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * SPEC §3.9. `mandatory` types (transactional and security) cannot be disabled.
 * PUSH arrives in a later phase; the matrix already lists it.
 */
export const NOTIFICATION_TYPES = [
  { key: 'message.new', mandatory: false },
  { key: 'offer.updates', mandatory: false },
  { key: 'order.updates', mandatory: true },
  { key: 'order.ship_reminder', mandatory: true },
  { key: 'payout.transferred', mandatory: true },
  { key: 'dispute.updates', mandatory: true },
  { key: 'feedback.received', mandatory: false },
  { key: 'feedback.reminder', mandatory: false },
  { key: 'saved_search.results', mandatory: false },
  { key: 'favorite.price_drop', mandatory: false },
  { key: 'listing.lifecycle', mandatory: false },
  { key: 'listing.moderation', mandatory: true },
  { key: 'security.alerts', mandatory: true },
  { key: 'tax.dac7', mandatory: true },
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]['key'];

export const notificationPreferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES.map((t) => t.key) as [NotificationType, ...NotificationType[]]),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});
export const notificationPreferencesUpdateSchema = z.object({
  preferences: z.array(notificationPreferenceSchema).max(100),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export function isMandatoryNotification(type: string): boolean {
  return NOTIFICATION_TYPES.some((t) => t.key === type && t.mandatory);
}
