-- Whether a dispute outcome is the seller's responsibility (SPEC §6.6–6.7).
ALTER TABLE "Dispute" ADD COLUMN "sellerAtFault" BOOLEAN;
