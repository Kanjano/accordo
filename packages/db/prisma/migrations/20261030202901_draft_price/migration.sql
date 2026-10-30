-- Drafts may be saved before a price is chosen (ADR-0025): price 0 is allowed only in DRAFT.
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_price_positive";
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_price_positive" CHECK ("priceCents" > 0 OR "status" = 'DRAFT');
