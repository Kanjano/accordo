import { z } from 'zod';
import type { ListingStatus } from './listings.js';

const body = z.string().trim().min(1, 'MESSAGE_EMPTY').max(2000, 'MESSAGE_TOO_LONG');

export const conversationCreateSchema = z.object({ listingId: z.uuid(), body });
export const messageCreateSchema = z.object({ body });
export const offerAmountSchema = z.object({ amountCents: z.number().int().positive() });

export const MESSAGE_REPORT_REASONS = ['SCAM', 'SPAM', 'ABUSE', 'OTHER'] as const;
export const messageReportSchema = z.object({
  reasonCode: z.enum(MESSAGE_REPORT_REASONS),
  details: z.string().trim().max(1000).default(''),
});

export type MessageType = 'TEXT' | 'IMAGE' | 'OFFER' | 'SYSTEM';
export type OfferStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'COUNTERED'
  | 'EXPIRED'
  | 'WITHDRAWN'
  | 'CONSUMED';
/** Offer events recorded in the conversation (`body` of OFFER messages). */
export type OfferEvent =
  | 'created'
  | 'countered'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired';

export interface OfferItem {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  proposedById: string;
  amountCents: number;
  status: OfferStatus;
  parentOfferId: string | null;
  /** Pending: reply deadline. Accepted: checkout deadline (listing reserved until then). */
  expiresAt: string;
  createdAt: string;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  /** null for system messages. */
  senderId: string | null;
  type: MessageType;
  /** Text (contacts possibly masked); for OFFER messages the OfferEvent. */
  body: string | null;
  flags: string[];
  /** Show the "pay only with protected payment" warning (SPEC §13.4). */
  warn: boolean;
  offer: OfferItem | null;
  readAt: string | null;
  createdAt: string;
}

export interface ConversationListing {
  id: string;
  shortId: string;
  slug: string;
  title: string;
  priceCents: number;
  status: ListingStatus;
  imageKey: string | null;
  isNegotiable: boolean;
  protectedPaymentEnabled: boolean;
}

export interface ConversationSummary {
  id: string;
  role: 'BUYER' | 'SELLER';
  listing: ConversationListing;
  otherParty: { id: string; username: string | null; name: string };
  lastMessage: { type: MessageType; body: string | null; senderId: string | null } | null;
  lastMessageAt: string;
  unread: number;
  archived: boolean;
}

export interface ConversationDetail extends ConversationSummary {
  /** Either party blocked the other: no new messages or offers. */
  blocked: boolean;
  /** Offers of this listing between these two users, newest first. */
  offers: OfferItem[];
}

export interface MyOfferItem extends OfferItem {
  listing: ConversationListing;
  conversationId: string | null;
}

/** Socket.IO events (SPEC §5.6). */
export interface ServerToClientEvents {
  'message:new': (e: { conversationId: string; message: MessageItem }) => void;
  'conversation:read': (e: { conversationId: string; readerId: string }) => void;
  'offer:updated': (e: { conversationId: string | null; offer: OfferItem }) => void;
  'notification:new': (e: { type: string; title: string }) => void;
}
