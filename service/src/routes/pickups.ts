import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import type { Attestation } from "../generated/prisma/client.js";
import {
  buildClaimPickupTx,
  buildConfirmPickupTx,
  submitSignedTransaction,
} from "../soroban/client.js";

function serializeAttestation(row: Attestation) {
  return {
    orderId: row.orderId,
    vendor: row.vendor,
    recipient: row.recipient,
    itemType: row.itemType,
    quantity: row.quantity,
    status: row.status,
    claimedAt: row.claimedAt,
    confirmedAt: row.confirmedAt,
    claimTxHash: row.claimTxHash,
    confirmTxHash: row.confirmTxHash,
  };
}

export async function pickupRoutes(app: FastifyInstance) {
  // --- Relay: build unsigned transactions, submit signed ones. The
  // caller (the real app's passkey wallet, or the demo client standing
  // in for it) signs locally with the vendor's/recipient's own key —
  // this service never receives a private key. ---

  app.post<{
    Params: { orderId: string };
    Body: { vendorPublicKey: string; recipientPublicKey: string; itemType: string; quantity: number };
  }>("/pickups/:orderId/claim/prepare", async (request, reply) => {
    const { orderId } = request.params;
    const { vendorPublicKey, recipientPublicKey, itemType, quantity } = request.body ?? {};
    if (!vendorPublicKey || !recipientPublicKey || !itemType || !quantity) {
      return reply
        .status(400)
        .send({ error: "vendorPublicKey, recipientPublicKey, itemType and quantity are required" });
    }

    const xdr = await buildClaimPickupTx({ orderId, vendorPublicKey, recipientPublicKey, itemType, quantity });
    return { xdr, networkPassphrase: config.networkPassphrase };
  });

  app.post<{ Params: { orderId: string }; Body: { recipientPublicKey: string } }>(
    "/pickups/:orderId/confirm/prepare",
    async (request, reply) => {
      const { recipientPublicKey } = request.body ?? {};
      if (!recipientPublicKey) {
        return reply.status(400).send({ error: "recipientPublicKey is required" });
      }

      const xdr = await buildConfirmPickupTx({ orderId: request.params.orderId, recipientPublicKey });
      return { xdr, networkPassphrase: config.networkPassphrase };
    },
  );

  // --- Deferred confirm: the recipient signs `confirm_pickup` at
  // checkout (before `claim_pickup` exists) and this just stores it.
  // The indexer (src/indexer/run.ts) submits it automatically once the
  // matching `claimed` event lands — see schema.prisma's
  // `PendingConfirmation` model for why this is safe to defer. ---
  app.post<{
    Params: { orderId: string };
    Body: { recipientPublicKey: string; func: string; auth: string[] };
  }>("/pickups/:orderId/pre-confirm", async (request, reply) => {
    const { orderId } = request.params;
    const { recipientPublicKey, func, auth } = request.body ?? {};
    if (!recipientPublicKey || !func || !auth?.length) {
      return reply
        .status(400)
        .send({ error: "recipientPublicKey, func and a non-empty auth array are required" });
    }

    const existing = await prisma.attestation.findUnique({ where: { orderId } });
    if (existing) {
      return reply
        .status(409)
        .send({ error: "This order has already been claimed — too late to pre-confirm, confirm directly instead" });
    }

    await prisma.pendingConfirmation.upsert({
      where: { orderId },
      create: { orderId, recipient: recipientPublicKey, funcXdr: func, authXdr: auth },
      // A re-checkout (e.g. retried payment) for the same order replaces
      // the stored authorization rather than erroring — the old one was
      // never submitted (that path returns 409 above) so there's
      // nothing to protect by refusing the overwrite.
      update: { recipient: recipientPublicKey, funcXdr: func, authXdr: auth, submitError: null },
    });

    return reply.status(201).send({ stored: true });
  });

  app.post<{ Body: { xdr: string } }>("/transactions/submit", async (request, reply) => {
    const { xdr } = request.body ?? {};
    if (!xdr) {
      return reply.status(400).send({ error: "xdr is required" });
    }
    const result = await submitSignedTransaction(xdr);
    // BigInt return values (e.g. a u64/u128 from some other contract call
    // through this generic endpoint) aren't JSON-serializable by default.
    return {
      ...result,
      returnValue:
        typeof result.returnValue === "bigint" ? result.returnValue.toString() : result.returnValue,
    };
  });

  // --- Read model, for the public dashboard and anyone checking a
  // specific claim. ---

  app.get("/pickups", async () => {
    const rows = await prisma.attestation.findMany({ orderBy: { claimedAt: "desc" } });
    return rows.map(serializeAttestation);
  });

  // Resolves a claim from a transaction hash — lets a caller that only
  // has a tx hash (e.g. a smart-wallet SDK whose submit result doesn't
  // surface the contract's return value) find the claim id it was
  // assigned, from the indexed read model rather than guessing.
  app.get<{ Params: { txHash: string } }>("/pickups/by-tx/:txHash", async (request, reply) => {
    const { txHash } = request.params;
    const row = await prisma.attestation.findFirst({
      where: { OR: [{ claimTxHash: txHash }, { confirmTxHash: txHash }] },
    });
    if (!row) {
      return reply.status(404).send({ error: "not found" });
    }
    return serializeAttestation(row);
  });

  app.get<{ Params: { orderId: string } }>("/pickups/:orderId", async (request, reply) => {
    const row = await prisma.attestation.findUnique({ where: { orderId: request.params.orderId } });
    if (!row) {
      return reply.status(404).send({ error: "not found" });
    }
    return serializeAttestation(row);
  });
}
