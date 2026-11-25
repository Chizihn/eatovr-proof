-- AlterTable
ALTER TABLE "attestations" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'commercial',
ADD COLUMN     "region" TEXT;

-- CreateTable
CREATE TABLE "order_metadata" (
    "order_id" TEXT NOT NULL,
    "region" TEXT,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_metadata_pkey" PRIMARY KEY ("order_id")
);
