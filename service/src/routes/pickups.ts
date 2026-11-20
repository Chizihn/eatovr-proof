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
    claimId: row.claimId.toString(),
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
    Body: { vendorPublicKey: string; recipientPublicKey: string; itemType: string; quantity: number };
  }>("/pickups/claim/prepare", async (request, reply) => {
    const { vendorPublicKey, recipientPublicKey, itemType, quantity } = request.body ?? {};
    if (!vendorPublicKey || !recipientPublicKey || !itemType || !quantity) {
      return reply
        .status(400)
        .send({ error: "vendorPublicKey, recipientPublicKey, itemType and quantity are required" });
    }

    const xdr = await buildClaimPickupTx({ vendorPublicKey, recipientPublicKey, itemType, quantity });
    return { xdr, networkPassphrase: config.networkPassphrase };
  });

  app.post<{ Params: { claimId: string }; Body: { recipientPublicKey: string } }>(
    "/pickups/:claimId/confirm/prepare",
    async (request, reply) => {
      const { recipientPublicKey } = request.body ?? {};
      if (!recipientPublicKey) {
        return reply.status(400).send({ error: "recipientPublicKey is required" });
      }

      let claimId: bigint;
      try {
        claimId = BigInt(request.params.claimId);
      } catch {
        return reply.status(400).send({ error: "claimId must be an integer" });
      }

      const xdr = await buildConfirmPickupTx({ claimId, recipientPublicKey });
      return { xdr, networkPassphrase: config.networkPassphrase };
    },
  );

  app.post<{ Body: { xdr: string } }>("/transactions/submit", async (request, reply) => {
    const { xdr } = request.body ?? {};
    if (!xdr) {
      return reply.status(400).send({ error: "xdr is required" });
    }
    const result = await submitSignedTransaction(xdr);
    // BigInt (e.g. a u64 claim_id) isn't JSON-serializable by default.
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

  app.get<{ Params: { claimId: string } }>("/pickups/:claimId", async (request, reply) => {
    let claimId: bigint;
    try {
      claimId = BigInt(request.params.claimId);
    } catch {
      return reply.status(400).send({ error: "claimId must be an integer" });
    }

    const row = await prisma.attestation.findUnique({ where: { claimId } });
    if (!row) {
      return reply.status(404).send({ error: "not found" });
    }
    return serializeAttestation(row);
  });
}
