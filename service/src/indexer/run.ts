import { prisma } from "../db/prisma.js";
import { sorobanServer } from "../soroban/client.js";
import { fetchEventsSince, type AttestationEvent } from "../soroban/events.js";
import { withRetry } from "../soroban/retry.js";
import { relayFuncAndAuth } from "../soroban/relayer.js";
import { releaseUnitIfSponsored } from "../sponsorship/service.js";

const CURSOR_ID = 1;

async function getStartLedger(): Promise<number> {
  const cursor = await prisma.indexerCursor.findUnique({ where: { id: CURSOR_ID } });
  if (cursor) {
    return Number(cursor.lastLedger) + 1;
  }
  // First run: start from the current ledger rather than the beginning
  // of history (and rather than ledger 0, which Soroban RPC's event
  // retention window would reject anyway).
  const latest = await withRetry(() => sorobanServer.getLatestLedger());
  return latest.sequence;
}

async function saveCursor(ledger: number): Promise<void> {
  await prisma.indexerCursor.upsert({
    where: { id: CURSOR_ID },
    create: { id: CURSOR_ID, lastLedger: BigInt(ledger) },
    update: { lastLedger: BigInt(ledger) },
  });
}

/**
 * If the recipient already signed (but didn't submit) a `confirm_pickup`
 * for this order at checkout — see `PendingConfirmation` in
 * schema.prisma — submit it now that the matching `claimed` event has
 * landed. This is the automatic half of the deferred-confirm flow: the
 * recipient never has to come back and tap anything.
 *
 * Deliberately swallows (logs, doesn't throw) submission failures —
 * this runs inside the indexer's poll loop, and one order's stuck
 * pending confirmation must not block indexing every other event.
 * Left with `submittedAt: null` on failure so the next poll retries it.
 */
async function submitPendingConfirmationIfAny(orderId: string): Promise<void> {
  const pending = await prisma.pendingConfirmation.findUnique({
    where: { orderId },
  });
  if (!pending || pending.submittedAt) return;

  try {
    const result = await relayFuncAndAuth(pending.funcXdr, pending.authXdr);
    await prisma.pendingConfirmation.update({
      where: { orderId },
      data: { submittedAt: new Date(), submitTxHash: result.hash, submitError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[indexer] deferred confirm_pickup submit failed for order ${orderId}:`, err);
    await prisma.pendingConfirmation.update({
      where: { orderId },
      data: { submitError: message },
    });
  }
}

async function applyEvent(event: AttestationEvent): Promise<void> {
  if (event.type === "claimed") {
    await prisma.attestation.upsert({
      where: { orderId: event.orderId },
      create: {
        orderId: event.orderId,
        vendor: event.vendor,
        recipient: event.recipient,
        itemType: event.itemType,
        quantity: event.quantity,
        status: "Pending",
        claimedAt: new Date(event.ledgerClosedAt),
        claimTxHash: event.txHash,
      },
      // The claim's own fields never change after creation; a replayed
      // `claimed` event (e.g. after a restart with an overlapping
      // startLedger) is a no-op.
      update: {},
    });
    await submitPendingConfirmationIfAny(event.orderId);
    return;
  }

  await prisma.attestation.upsert({
    where: { orderId: event.orderId },
    create: {
      orderId: event.orderId,
      vendor: event.vendor,
      recipient: event.recipient,
      itemType: event.itemType,
      quantity: event.quantity,
      status: "Finalized",
      claimedAt: new Date(Number(event.claimedAt) * 1000),
      confirmedAt: new Date(Number(event.confirmedAt) * 1000),
      confirmTxHash: event.txHash,
      // Only reachable if the `finalized` event is seen without the
      // matching `claimed` event having been indexed first (e.g. the
      // indexer started after both already happened) — there is no
      // claim tx hash to backfill in that case.
      claimTxHash: "unknown",
    },
    update: {
      status: "Finalized",
      // `finalized`'s claimed_at is the authoritative on-chain value;
      // reconcile it in case the earlier `claimed` event only had the
      // ledger-close-time approximation.
      claimedAt: new Date(Number(event.claimedAt) * 1000),
      confirmedAt: new Date(Number(event.confirmedAt) * 1000),
      confirmTxHash: event.txHash,
    },
  });

  // If this order funds a Sponsor Food unit, release its escrow now
  // that both parties have independently confirmed the pickup — see
  // sponsorship/service.ts's `releaseUnitIfSponsored` for why this is
  // a no-op for every ordinary (non-sponsored) order.
  await releaseUnitIfSponsored(event.orderId);
}

let running = false;

export async function pollOnce(): Promise<void> {
  const startLedger = await getStartLedger();
  const { events, latestLedger } = await fetchEventsSince(startLedger);

  for (const event of events) {
    await applyEvent(event);
  }

  if (latestLedger >= startLedger) {
    await saveCursor(latestLedger);
  }
}

export function startIndexer(intervalMs: number): NodeJS.Timeout {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollOnce();
    } catch (err) {
      console.error("[indexer] poll failed:", err);
    } finally {
      running = false;
    }
  };

  void tick();
  return setInterval(tick, intervalMs);
}
