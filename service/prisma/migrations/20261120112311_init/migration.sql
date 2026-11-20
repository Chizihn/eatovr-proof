-- CreateTable
CREATE TABLE "attestations" (
    "claim_id" BIGINT NOT NULL,
    "vendor" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "claim_tx_hash" TEXT NOT NULL,
    "confirm_tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attestations_pkey" PRIMARY KEY ("claim_id")
);

-- CreateTable
CREATE TABLE "indexer_cursor" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_ledger" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexer_cursor_pkey" PRIMARY KEY ("id")
);
