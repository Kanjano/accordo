-- Un solo ordine "attivo" per annuncio: impedisce il doppio acquisto anche in caso di richieste concorrenti
CREATE UNIQUE INDEX "Order_one_active_per_listing" ON "Order" ("listingId")
  WHERE "status" IN ('CHECKOUT_PENDING','PAID','HANDOVER_PENDING','SHIPPED','DELIVERED','DISPUTED','RETURN_IN_TRANSIT');

-- Vincoli di dominio
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_price_positive" CHECK ("priceCents" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_valid" CHECK (
  "itemPriceCents" > 0 AND "shippingPriceCents" >= 0 AND "buyerFeeCents" >= 0
  AND "refundedCents" >= 0 AND "refundedCents" <= "totalCents"
  AND "totalCents" = "itemPriceCents" + "shippingPriceCents" + "buyerFeeCents");
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_dsr_range" CHECK (
  ("dsrItemAsDescribed" IS NULL OR "dsrItemAsDescribed" BETWEEN 1 AND 5) AND
  ("dsrCommunication"   IS NULL OR "dsrCommunication"   BETWEEN 1 AND 5) AND
  ("dsrShippingTime"    IS NULL OR "dsrShippingTime"    BETWEEN 1 AND 5) AND
  ("dsrPackaging"       IS NULL OR "dsrPackaging"       BETWEEN 1 AND 5));
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_seller_only_positive"
  CHECK ("role" <> 'SELLER_TO_BUYER' OR "rating" = 'POSITIVE');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amountCents" > 0);

-- Ricerca di riserva e filtri sugli attributi
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Listing_title_trgm" ON "Listing" USING gin ("title" gin_trgm_ops);
CREATE INDEX "Listing_attributes_gin" ON "Listing" USING gin ("attributes" jsonb_path_ops);
