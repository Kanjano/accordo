-- Who proposed each offer: the buyer for root offers, then alternating along counter-offers.
ALTER TABLE "Offer" ADD COLUMN "proposedById" TEXT;

WITH RECURSIVE chain AS (
  SELECT id, "buyerId" AS proposer FROM "Offer" WHERE "parentOfferId" IS NULL
  UNION ALL
  SELECT o.id, CASE WHEN c.proposer = o."buyerId" THEN o."sellerId" ELSE o."buyerId" END
  FROM "Offer" o JOIN chain c ON o."parentOfferId" = c.id
)
UPDATE "Offer" SET "proposedById" = chain.proposer FROM chain WHERE "Offer".id = chain.id;

ALTER TABLE "Offer" ALTER COLUMN "proposedById" SET NOT NULL;

-- Offer amounts are always positive.
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_amount_positive" CHECK ("amountCents" > 0);
