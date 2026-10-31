-- Appeal review by a second staff member (SPEC §6.6).
ALTER TABLE "Dispute" ADD COLUMN "appealResolvedAt" TIMESTAMP(3),
  ADD COLUMN "appealResolvedById" TEXT,
  ADD COLUMN "appealUpheld" BOOLEAN,
  ADD COLUMN "appealNotes" TEXT;
