/*
  Warnings:

  - The primary key for the `attestations` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `claim_id` on the `attestations` table. All the data in the column will be lost.
  - Added the required column `order_id` to the `attestations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "attestations" DROP CONSTRAINT "attestations_pkey",
DROP COLUMN "claim_id",
ADD COLUMN     "order_id" TEXT NOT NULL,
ADD CONSTRAINT "attestations_pkey" PRIMARY KEY ("order_id");

-- CreateTable
CREATE TABLE "pending_confirmations" (
    "order_id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "func_xdr" TEXT NOT NULL,
    "auth_xdr" TEXT[],
    "submitted_at" TIMESTAMP(3),
    "submit_tx_hash" TEXT,
    "submit_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_confirmations_pkey" PRIMARY KEY ("order_id")
);
