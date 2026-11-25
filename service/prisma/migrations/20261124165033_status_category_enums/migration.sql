-- CreateEnum
CREATE TYPE "AttestationStatus" AS ENUM ('Pending', 'Finalized');
CREATE TYPE "OrderCategory" AS ENUM ('commercial', 'donation_recovery');
CREATE TYPE "SponsorshipBatchStatus" AS ENUM ('Funding', 'Active', 'Depleted');
CREATE TYPE "SponsorshipUnitStatus" AS ENUM ('Pending', 'Available', 'Claimed', 'Redeemed');

-- AlterTable: attestations
-- Existing string values already match the new enum's labels exactly,
-- so a straight USING cast preserves every row — no data loss.
ALTER TABLE "attestations" ALTER COLUMN "status" TYPE "AttestationStatus" USING ("status"::"AttestationStatus");

ALTER TABLE "attestations" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "attestations" ALTER COLUMN "category" TYPE "OrderCategory" USING ("category"::"OrderCategory");
ALTER TABLE "attestations" ALTER COLUMN "category" SET DEFAULT 'commercial';

-- AlterTable: order_metadata
ALTER TABLE "order_metadata" ALTER COLUMN "category" TYPE "OrderCategory" USING ("category"::"OrderCategory");

-- AlterTable: sponsorship_batches
ALTER TABLE "sponsorship_batches" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "sponsorship_batches" ALTER COLUMN "status" TYPE "SponsorshipBatchStatus" USING ("status"::"SponsorshipBatchStatus");
ALTER TABLE "sponsorship_batches" ALTER COLUMN "status" SET DEFAULT 'Funding';

-- AlterTable: sponsorship_units
ALTER TABLE "sponsorship_units" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "sponsorship_units" ALTER COLUMN "status" TYPE "SponsorshipUnitStatus" USING ("status"::"SponsorshipUnitStatus");
ALTER TABLE "sponsorship_units" ALTER COLUMN "status" SET DEFAULT 'Pending';
