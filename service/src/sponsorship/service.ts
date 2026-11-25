import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import { OrderCategory, SponsorshipBatchStatus, SponsorshipUnitStatus } from "../generated/prisma/client.js";
import { readUsdcUsdPrice } from "../reflector/client.js";
import {
  DEFAULT_SPONSORSHIP_CURRENCY,
  isSponsorshipCurrency,
  mealPriceInCurrency,
  tierById,
  unitValueUsdc,
  type SponsorshipCurrency,
} from "./tiers.js";
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

/** Trustless Work's own `/helper/send-transaction` status literal — their protocol constant, not ours, named here rather than inlined. */
const TRUSTLESS_WORK_SEND_STATUS_SUCCESS = "SUCCESS";

function assertSucceeded(result: Record<string, unknown>): void {
  if (result.status !== TRUSTLESS_WORK_SEND_STATUS_SUCCESS) {
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
  currency?: string;
}): Promise<{
  batchId: string;
  units: { unitId: string; index: number; deployXdr: string }[];
}> {
  const tier = tierById(params.tierId);
  const currency: SponsorshipCurrency =
    params.currency && isSponsorshipCurrency(params.currency)
      ? params.currency
      : DEFAULT_SPONSORSHIP_CURRENCY;
  const unitValue = unitValueUsdc(currency);
  const reflectorPrice = await readUsdcUsdPrice().catch(() => null);

  const batch = await prisma.sponsorshipBatch.create({
    data: {
      donorPublicKey: params.donorPublicKey,
      region: params.region ?? null,
      currency,
      unitCount: tier.unitCount,
      unitValueUsdc: unitValue,
      reflectorUsdPrice: reflectorPrice?.price ?? null,
      status: SponsorshipBatchStatus.Funding,
    },
  });

  const units: { unitId: string; index: number; deployXdr: string }[] = [];

  for (let index = 0; index < tier.unitCount; index += 1) {
    const unit = await prisma.sponsorshipUnit.create({
      data: { batchId: batch.id, index, status: SponsorshipUnitStatus.Pending },
    });

    const deployed = await deployUnitEscrow({
      engagementId: `${batch.id}:${index}`,
      donorPublicKey: params.donorPublicKey,
      platformPublicKey: platformPublicKey(),
      amountUsdc: unitValue,
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
    data: { status: SponsorshipUnitStatus.Available, fundingTxHash: txHashHex(tx) },
  });

  const unit = await prisma.sponsorshipUnit.findUniqueOrThrow({ where: { id: params.unitId } });
  const siblings = await prisma.sponsorshipUnit.findMany({ where: { batchId: unit.batchId } });
  if (siblings.every((u) => u.status !== SponsorshipUnitStatus.Pending)) {
    await prisma.sponsorshipBatch.update({
      where: { id: unit.batchId },
      data: { status: SponsorshipBatchStatus.Active },
    });
  }
}

/**
 * Reserves a unit — first-come-first-served within a region match,
 * explicitly disclosed as a demo simplification (see
 * docs/BUILDATHON-PLAN.md): the real product gates this through
 * verified NGOs/beneficiaries, not any customer.
 *
 * Deliberately does NOT mint an `orderId` here. A sponsored-meal
 * credit is a fixed-value credit, not pre-tied to a vendor or
 * listing — the recipient picks any listing afterwards, through
 * Eatovr's own checkout, and only *that* produces a real `orderId`.
 * `attachOrderToUnit` below is what fills it in, once it exists.
 */
/**
 * Read-only check for the app's home-screen card — never reserves a
 * unit, so just loading the home screen can't silently consume one
 * (see `claimSponsorshipUnit` for the action that actually does).
 */
export async function hasAvailableSponsorshipUnit(params: { region?: string }): Promise<boolean> {
  const unit = await prisma.sponsorshipUnit.findFirst({
    where: {
      status: SponsorshipUnitStatus.Available,
      batch: params.region ? { OR: [{ region: params.region }, { region: null }] } : undefined,
    },
    select: { id: true },
  });
  return unit !== null;
}

export async function claimSponsorshipUnit(params: {
  region?: string;
}): Promise<{ batchId: string; unitId: string; creditAmount: number; currency: SponsorshipCurrency } | null> {
  const unit = await prisma.sponsorshipUnit.findFirst({
    where: {
      status: SponsorshipUnitStatus.Available,
      batch: params.region ? { OR: [{ region: params.region }, { region: null }] } : undefined,
    },
    include: { batch: true },
    orderBy: { createdAt: "asc" },
  });
  if (!unit) return null;

  await prisma.sponsorshipUnit.update({
    where: { id: unit.id },
    data: { status: SponsorshipUnitStatus.Claimed, claimedAt: new Date() },
  });

  // The fixed per-meal value this unit's escrow actually backs, in
  // whichever of Nigeria or Ghana's currencies the donor funded it in
  // — the real Eatovr backend needs this to issue the credit itself,
  // and must not re-derive it independently (see tiers.ts's doc
  // comment on why this constant is demo-illustrative, not live-priced).
  const currency = isSponsorshipCurrency(unit.batch.currency)
    ? unit.batch.currency
    : DEFAULT_SPONSORSHIP_CURRENCY;
  return {
    batchId: unit.batchId,
    unitId: unit.id,
    creditAmount: mealPriceInCurrency(currency),
    currency,
  };
}

/**
 * Called by the real Eatovr backend once the recipient actually
 * redeems their sponsored-meal credit at checkout against a real
 * listing (see docs/BUILDATHON-PLAN.md) — this is the first point a
 * real `orderId` exists for this unit. From here on the order goes
 * through the exact same unmodified claim_pickup/confirm_pickup flow
 * as any other order; `releaseUnitIfSponsored` picks it back up by
 * `claimedOrderId` once it finalizes on-chain.
 */
export async function attachOrderToUnit(params: {
  unitId: string;
  orderId: string;
}): Promise<void> {
  const unit = await prisma.sponsorshipUnit.findUniqueOrThrow({
    where: { id: params.unitId },
    include: { batch: true },
  });
  if (unit.status !== SponsorshipUnitStatus.Claimed) {
    throw new Error(`Unit ${unit.id} is ${unit.status}, not Claimed — cannot attach an order to it`);
  }
  if (unit.claimedOrderId && unit.claimedOrderId !== params.orderId) {
    throw new Error(`Unit ${unit.id} already has a different order attached (${unit.claimedOrderId})`);
  }

  await prisma.sponsorshipUnit.update({
    where: { id: unit.id },
    data: { claimedOrderId: params.orderId },
  });

  // A sponsored meal is a donation reaching its recipient, not a sale
  // — the dashboard's category filter needs this to actually
  // distinguish the two, and it can't be inferred from the `claimed`
  // event itself (see schema.prisma's `OrderMetadata` doc comment).
  // The batch's own region carries over too, so the attestation ends
  // up filterable by the same region the donor targeted.
  await prisma.orderMetadata.upsert({
    where: { orderId: params.orderId },
    create: { orderId: params.orderId, region: unit.batch.region, category: OrderCategory.donation_recovery },
    update: { region: unit.batch.region, category: OrderCategory.donation_recovery },
  });
}

/**
 * Tells the real Eatovr backend that a sponsored unit's escrow
 * released, so it can create the vendor's `CryptoFundedVendorObligation`
 * row and pay them out through its existing settlement rail. Never
 * throws — a failed delivery just leaves `backendNotifiedAt` unset,
 * and `retryPendingBackendNotifications` (called from the indexer's
 * own poll loop) keeps retrying it, same swallow-and-retry-next-poll
 * pattern as `releaseUnitIfSponsored` itself.
 */
async function notifyBackendOfRelease(unit: {
  id: string;
  claimedOrderId: string | null;
  escrowContractId: string | null;
  releaseTxHash: string | null;
}): Promise<void> {
  if (!config.eatovrBackendUrl) return;
  try {
    const response = await fetch(`${config.eatovrBackendUrl}/sponsorship/webhook/released`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sponsorship-webhook-secret": config.sponsorshipWebhookSecret,
      },
      body: JSON.stringify({
        unitId: unit.id,
        orderId: unit.claimedOrderId,
        escrowContractId: unit.escrowContractId,
        releaseTxHash: unit.releaseTxHash,
      }),
    });
    if (!response.ok) {
      throw new Error(`Backend webhook responded ${response.status}: ${await response.text()}`);
    }
    await prisma.sponsorshipUnit.update({
      where: { id: unit.id },
      data: { backendNotifiedAt: new Date() },
    });
  } catch (err) {
    console.error(`[sponsorship] release webhook failed for unit ${unit.id}:`, err);
  }
}

/** Called each indexer poll — see `notifyBackendOfRelease`. */
export async function retryPendingBackendNotifications(): Promise<void> {
  const pending = await prisma.sponsorshipUnit.findMany({
    where: { status: SponsorshipUnitStatus.Redeemed, backendNotifiedAt: null },
  });
  for (const unit of pending) {
    await notifyBackendOfRelease(unit);
  }
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
  if (!unit || unit.status !== SponsorshipUnitStatus.Claimed || !unit.escrowContractId) return;

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
      data: {
        status: SponsorshipUnitStatus.Redeemed,
        releaseTxHash: txHash,
        releasedAt: new Date(),
        releaseError: null,
      },
    });

    await notifyBackendOfRelease({ ...unit, releaseTxHash: txHash });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sponsorship] release failed for order ${orderId}:`, err);
    await prisma.sponsorshipUnit.update({ where: { id: unit.id }, data: { releaseError: message } });
  }
}
