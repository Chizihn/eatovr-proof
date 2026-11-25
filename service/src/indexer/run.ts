import { prisma } from "../db/prisma.js";
import { AttestationStatus, type OrderCategory } from "../generated/prisma/client.js";
import { sorobanServer } from "../soroban/client.js";
import { fetchEventsSince, type AttestationEvent } from "../soroban/events.js";
import { withRetry } from "../soroban/retry.js";
import { relayFuncAndAuth } from "../soroban/relayer.js";
import { releaseUnitIfSponsored, retryPendingBackendNotifications } from "../sponsorship/service.js";

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

/**
 * Region/category for an order, stashed in `OrderMetadata` before
 * `claim_pickup` ever ran (see schema.prisma's doc comment) — the
 * `claimed` event itself carries neither field, so this is the only
 * place either one can come from. Missing metadata (the common case
 * for a demo order that never set any) just means an attestation row
 * with `region: null`, `category` falling back to its schema default.
 */
async function lookupOrderMetadata(
  orderId: string,
): Promise<{ region: string | null; category: OrderCategory | undefined }> {
  const metadata = await prisma.orderMetadata.findUnique({ where: { orderId } });
  return { region: metadata?.region ?? null, category: metadata?.category ?? undefined };
}

async function applyEvent(event: AttestationEvent): Promise<void> {
  if (event.type === "claimed") {
    const { region, category } = await lookupOrderMetadata(event.orderId);
    await prisma.attestation.upsert({
      where: { orderId: event.orderId },
      create: {
        orderId: event.orderId,
        vendor: event.vendor,
        recipient: event.recipient,
        itemType: event.itemType,
        quantity: event.quantity,
        status: AttestationStatus.Pending,
        region,
        ...(category ? { category } : {}),
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

  const { region, category } = await lookupOrderMetadata(event.orderId);
  await prisma.attestation.upsert({
    where: { orderId: event.orderId },
    create: {
      orderId: event.orderId,
      vendor: event.vendor,
      recipient: event.recipient,
      region,
      ...(category ? { category } : {}),
      itemType: event.itemType,
      quantity: event.quantity,
      status: AttestationStatus.Finalized,
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
      status: AttestationStatus.Finalized,
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

/** Returns how many events this pass actually applied, so callers can tell an empty poll from a real one. */
export async function pollOnce(): Promise<number> {
  const startLedger = await getStartLedger();
  const { events, latestLedger } = await fetchEventsSince(startLedger);

  for (const event of events) {
    await applyEvent(event);
  }

  if (latestLedger >= startLedger) {
    await saveCursor(latestLedger);
  }

  // Retries any Redeemed unit whose release webhook to the real Eatovr
  // backend hasn't been acknowledged yet — see
  // sponsorship/service.ts's `notifyBackendOfRelease`. Runs every poll,
  // not just when there are new events, so a backend outage resolves
  // itself as soon as it comes back up rather than waiting on the next
  // on-chain event.
  await retryPendingBackendNotifications();

  return events.length;
}

/**
 * Runs one poll synchronously and swallows errors — call this from a
 * request handler right after submitting a transaction, so indexing
 * (and everything chained off it: the deferred-confirm auto-submit,
 * the sponsorship auto-release) doesn't depend on a background timer
 * ever ticking again before the caller needs to see the result.
 *
 * This is what actually makes the serverless deploy target work (see
 * docs/DEPLOYMENT.md's Vercel section): a platform that only runs
 * code while handling a request has no reliable way to keep
 * `startIndexer`'s `setInterval` alive between requests, so every
 * submission site in `routes/pickups.ts` and `routes/relayer.ts`
 * calls this directly instead of waiting for the next tick. Safe to
 * call even where the interval *is* reliable (Railway/Render/local)
 * — it shares the same `running` guard, so the two never race.
 *
 * Retries a couple of times on an empty first pass — confirmed live:
 * Soroban RPC's `getEvents` has a short propagation lag after ledger
 * close, so polling in the same instant `submitAndWait` resolves can
 * genuinely miss the event that very transaction just produced. On a
 * host with a persistent background poller this self-heals on the
 * next tick; on Vercel there may be no next tick until some unrelated
 * request happens to trigger one, so the retry has to live here.
 */
export async function triggerIndexOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const applied = await pollOnce();
      if (applied > 0 || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } catch (err) {
    console.error("[indexer] triggered poll failed:", err);
  } finally {
    running = false;
  }
}

/**
 * Optional on a platform that keeps one process running continuously
 * (Railway, Render, local dev) — belt-and-suspenders in case
 * something was submitted outside this service's own routes. Not
 * required for correctness: see `triggerIndexOnce` above, which is
 * what every submission path actually relies on. Harmless to call on
 * Vercel too (each warm instance just gets an interval that may or
 * may not survive to its next tick), just not something to depend on
 * there.
 */
export function startIndexer(intervalMs: number): NodeJS.Timeout {
  void triggerIndexOnce();
  return setInterval(() => void triggerIndexOnce(), intervalMs);
}
