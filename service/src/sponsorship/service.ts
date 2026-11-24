import { randomUUID } from "node:crypto";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import { readUsdcUsdPrice } from "../reflector/client.js";
import { tierById, UNIT_VALUE_USDC } from "./tiers.js";
import {
  approveUnitMilestone,
  completeUnitMilestone,
  deployUnitEscrow,
  fundUnitEscrow,
  releaseUnitFunds,
  sendSignedTransaction,
} from "./trustless-work.js";

/**
 * Trustless Work's own `/helper/send-transaction` response doesn't
 * reliably echo a Stellar tx hash back (confirmed live: present for
 * none of deploy/fund/release) — computing it directly from the
 * signed transaction is deterministic and doesn't depend on their
 * response shape at all.
 */
function txHashHex(tx: { hash(): Uint8Array }): string {
  return Buffer.from(tx.hash()).toString("hex");
}

/** Signs an unsigned transaction from Trustless Work with the platform key and submits it through them. */
async function signAsPlatformAndSubmit(
  unsignedTransaction: string,
): Promise<{ sent: Record<string, unknown>; txHash: string }> {
  const tx = TransactionBuilder.fromXDR(unsignedTransaction, config.networkPassphrase);
  tx.sign(Keypair.fromSecret(config.platformSecret));
  const sent = await sendSignedTransaction(tx.toXDR());
  assertSucceeded(sent);
  return { sent, txHash: txHashHex(tx) };
}

function platformPublicKey(): string {
  if (!config.platformSecret) {
    throw new Error(
      "PLATFORM_SECRET is not set — generate a funded testnet keypair for Sponsor Food's settlement address first.",
    );
  }
  return Keypair.fromSecret(config.platformSecret).publicKey();
}

function assertSucceeded(result: Record<string, unknown>): void {
  if (result.status !== "SUCCESS") {
    throw new Error(`Trustless Work send-transaction did not succeed: ${JSON.stringify(result)}`);
  }
}

/**
 * Trustless Work's own escrow contract id. Confirmed live: a deploy
 * transaction's `/helper/send-transaction` response includes this
 * directly — no separate indexer lookup needed.
 */
function extractContractId(result: Record<string, unknown>): string {
  const candidate =
    result.contractId ??
    result.contract_id ??
    (result.escrow as Record<string, unknown> | undefined)?.contractId ??
    (result.data as Record<string, unknown> | undefined)?.contractId;
  if (typeof candidate !== "string") {
    throw new Error(`Trustless Work response had no recognizable contract id: ${JSON.stringify(result)}`);
  }
  return candidate;
}

/**
 * Creates a batch and, for each unit, deploys its own Trustless Work
 * escrow (see trustless-work.ts for why one-per-unit). Returns each
 * unit's unsigned deploy transaction for the donor's connected wallet
 * to sign — this never holds the donor's key.
 */
export async function createSponsorshipBatch(params: {
  donorPublicKey: string;
  tierId: string;
  region?: string;
}): Promise<{
  batchId: string;
  units: { unitId: string; index: number; deployXdr: string }[];
}> {
  const tier = tierById(params.tierId);
  const reflectorPrice = await readUsdcUsdPrice().catch(() => null);

  const batch = await prisma.sponsorshipBatch.create({
    data: {
      donorPublicKey: params.donorPublicKey,
      region: params.region ?? null,
      unitCount: tier.unitCount,
      unitValueUsdc: UNIT_VALUE_USDC,
      reflectorUsdPrice: reflectorPrice?.price ?? null,
      status: "Funding",
    },
  });

  const units: { unitId: string; index: number; deployXdr: string }[] = [];

  for (let index = 0; index < tier.unitCount; index += 1) {
    const unit = await prisma.sponsorshipUnit.create({
      data: { batchId: batch.id, index, status: "Pending" },
    });

    const deployed = await deployUnitEscrow({
      engagementId: `${batch.id}:${index}`,
      donorPublicKey: params.donorPublicKey,
      platformPublicKey: platformPublicKey(),
      amountUsdc: UNIT_VALUE_USDC,
      trustlineIssuer: config.usdcIssuer,
    });

    units.push({ unitId: unit.id, index, deployXdr: deployed.unsignedTransaction });
  }

  return { batchId: batch.id, units };
}

/**
 * Submits the donor's signed escrow-deploy transaction through
 * Trustless Work's own `/helper/send-transaction` (their indexer
 * needs to observe it) — its response includes the new escrow's
 * `contractId` directly, confirmed live, no separate indexer lookup
 * needed — then immediately requests the matching fund transaction;
 * the donor's wallet signs that one too, in `submitUnitFunding` below.
 */
export async function submitUnitDeploy(params: {
  unitId: string;
  signedXdr: string;
}): Promise<{ fundXdr: string }> {
  const unit = await prisma.sponsorshipUnit.findUniqueOrThrow({ where: { id: params.unitId } });
  const batch = await prisma.sponsorshipBatch.findUniqueOrThrow({ where: { id: unit.batchId } });

  const sent = await sendSignedTransaction(params.signedXdr);
  assertSucceeded(sent);
  const contractId = extractContractId(sent);

  await prisma.sponsorshipUnit.update({
    where: { id: unit.id },
    data: { escrowContractId: contractId },
  });

  const funded = await fundUnitEscrow({
    contractId,
    donorPublicKey: batch.donorPublicKey,
    amountUsdc: batch.unitValueUsdc,
  });

  return { fundXdr: funded.unsignedTransaction };
}

/** Submits the donor's signed escrow-fund transaction — the unit is Available once this lands. */
export async function submitUnitFunding(params: {
  unitId: string;
  signedXdr: string;
}): Promise<void> {
  const tx = TransactionBuilder.fromXDR(params.signedXdr, config.networkPassphrase);
  const sent = await sendSignedTransaction(params.signedXdr);
  assertSucceeded(sent);

  await prisma.sponsorshipUnit.update({
    where: { id: params.unitId },
    data: { status: "Available", fundingTxHash: txHashHex(tx) },
  });

  const unit = await prisma.sponsorshipUnit.findUniqueOrThrow({ where: { id: params.unitId } });
  const siblings = await prisma.sponsorshipUnit.findMany({ where: { batchId: unit.batchId } });
  if (siblings.every((u) => u.status !== "Pending")) {
    await prisma.sponsorshipBatch.update({ where: { id: unit.batchId }, data: { status: "Active" } });
  }
}

/**
 * The demo "claim a sponsored meal" surface — first-come-first-served
 * within a region match, explicitly disclosed as a demo
 * simplification (see docs/BUILDATHON-PLAN.md): the real product
 * gates this through verified NGOs/beneficiaries, not any customer.
 */
export async function claimSponsorshipUnit(params: {
  region?: string;
}): Promise<{ batchId: string; unitId: string; orderId: string } | null> {
  const unit = await prisma.sponsorshipUnit.findFirst({
    where: {
      status: "Available",
      batch: params.region ? { OR: [{ region: params.region }, { region: null }] } : undefined,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!unit) return null;

  const orderId = `sponsored-${randomUUID()}`;

  await prisma.sponsorshipUnit.update({
    where: { id: unit.id },
    data: { status: "Claimed", claimedOrderId: orderId, claimedAt: new Date() },
  });

  return { batchId: unit.batchId, unitId: unit.id, orderId };
}

/**
 * Called by the indexer (indexer/run.ts) when an order's pickup
 * finalizes on-chain. Looks up whether that order funds a
 * sponsorship unit and, if so, releases its escrow — same
 * swallow-and-retry-next-poll error handling as
 * `submitPendingConfirmationIfAny`, for the same reason: one stuck
 * release must not block indexing every other event.
 *
 * Release itself requires the escrow's milestone to be completed
 * then approved first (confirmed live — see trustless-work.ts's
 * `completeUnitMilestone` doc comment) — both roles are the platform
 * address in this design, so all three steps happen unilaterally here.
 */
export async function releaseUnitIfSponsored(orderId: string): Promise<void> {
  const unit = await prisma.sponsorshipUnit.findUnique({ where: { claimedOrderId: orderId } });
  if (!unit || unit.status !== "Claimed" || !unit.escrowContractId) return;

  try {
    const platformKey = platformPublicKey();

    const completed = await completeUnitMilestone({
      contractId: unit.escrowContractId,
      platformPublicKey: platformKey,
      evidence: `Eatovr order ${orderId}: pickup independently confirmed by vendor and recipient on-chain`,
    });
    await signAsPlatformAndSubmit(completed.unsignedTransaction);

    const approved = await approveUnitMilestone({
      contractId: unit.escrowContractId,
      platformPublicKey: platformKey,
    });
    await signAsPlatformAndSubmit(approved.unsignedTransaction);

    const released = await releaseUnitFunds({
      contractId: unit.escrowContractId,
      platformPublicKey: platformKey,
    });
    const { txHash } = await signAsPlatformAndSubmit(released.unsignedTransaction);

    await prisma.sponsorshipUnit.update({
      where: { id: unit.id },
      data: { status: "Redeemed", releaseTxHash: txHash, releasedAt: new Date(), releaseError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sponsorship] release failed for order ${orderId}:`, err);
    await prisma.sponsorshipUnit.update({ where: { id: unit.id }, data: { releaseError: message } });
  }
}
