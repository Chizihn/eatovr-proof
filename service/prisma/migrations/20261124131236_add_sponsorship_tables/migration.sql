-- CreateTable
CREATE TABLE "sponsorship_batches" (
    "id" TEXT NOT NULL,
    "donor_public_key" TEXT NOT NULL,
    "region" TEXT,
    "unit_count" INTEGER NOT NULL,
    "unit_value_usdc" TEXT NOT NULL,
    "reflector_usd_price" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Funding',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsorship_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsorship_units" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "escrow_contract_id" TEXT,
    "funding_tx_hash" TEXT,
    "claimed_order_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "release_tx_hash" TEXT,
    "released_at" TIMESTAMP(3),
    "release_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsorship_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_units_claimed_order_id_key" ON "sponsorship_units"("claimed_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sponsorship_units_batch_id_index_key" ON "sponsorship_units"("batch_id", "index");

-- AddForeignKey
ALTER TABLE "sponsorship_units" ADD CONSTRAINT "sponsorship_units_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "sponsorship_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
