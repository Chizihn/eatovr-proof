import { prisma } from "../db/prisma.js";
import { sorobanServer } from "../soroban/client.js";
import { fetchEventsSince, type AttestationEvent } from "../soroban/events.js";
import { withRetry } from "../soroban/retry.js";

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

async function applyEvent(event: AttestationEvent): Promise<void> {
  if (event.type === "claimed") {
    await prisma.attestation.upsert({
      where: { claimId: event.claimId },
      create: {
        claimId: event.claimId,
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
    return;
  }

  await prisma.attestation.upsert({
    where: { claimId: event.claimId },
    create: {
      claimId: event.claimId,
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
