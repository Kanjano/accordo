-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;
