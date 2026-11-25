import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db/prisma.js";
import {
  SponsorshipUnitStatus,
  type SponsorshipBatchStatus,
} from "../generated/prisma/client.js";
import { SPONSORSHIP_TIERS } from "../sponsorship/tiers.js";
import {
  attachOrderToUnit,
  claimSponsorshipUnit,
  createSponsorshipBatch,
  hasAvailableSponsorshipUnit,
  submitUnitDeploy,
  submitUnitFunding,
} from "../sponsorship/service.js";

function serializeBatch(batch: {
  id: string;
  donorPublicKey: string;
  region: string | null;
  currency: string;
  unitCount: number;
  unitValueUsdc: string;
  reflectorUsdPrice: string | null;
  status: SponsorshipBatchStatus;
  createdAt: Date;
  units: {
    id: string;
    index: number;
    status: SponsorshipUnitStatus;
    escrowContractId: string | null;
    fundingTxHash: string | null;
    releaseTxHash: string | null;
    claimedOrderId: string | null;
  }[];
}) {
  return {
    id: batch.id,
    donor: batch.donorPublicKey,
    region: batch.region,
    currency: batch.currency,
    unitCount: batch.unitCount,
    unitValueUsdc: batch.unitValueUsdc,
    reflectorUsdPrice: batch.reflectorUsdPrice,
    status: batch.status,
    createdAt: batch.createdAt,
    available: batch.units.filter((u) => u.status === SponsorshipUnitStatus.Available).length,
    claimed: batch.units.filter((u) => u.status === SponsorshipUnitStatus.Claimed).length,
    redeemed: batch.units.filter((u) => u.status === SponsorshipUnitStatus.Redeemed).length,
    units: batch.units.map((u) => ({
      id: u.id,
      index: u.index,
      status: u.status,
      escrowContractId: u.escrowContractId,
      fundingTxHash: u.fundingTxHash,
      releaseTxHash: u.releaseTxHash,
      claimedOrderId: u.claimedOrderId,
    })),
  };
}

export async function sponsorshipRoutes(app: FastifyInstance) {
  app.get("/sponsorships/tiers", async () => SPONSORSHIP_TIERS);

  app.get("/sponsorships", async () => {
    const batches = await prisma.sponsorshipBatch.findMany({
      include: { units: true },
      orderBy: { createdAt: "desc" },
    });
    return batches.map(serializeBatch);
  });

  app.get<{ Params: { batchId: string } }>("/sponsorships/:batchId", async (request, reply) => {
    const batch = await prisma.sponsorshipBatch.findUnique({
      where: { id: request.params.batchId },
      include: { units: true },
    });
    if (!batch) return reply.status(404).send({ error: "not found" });
    return serializeBatch(batch);
  });

  // --- Donor flow: create a batch, deploy one escrow per unit, hand
  // back unsigned transactions for the donor's connected wallet
  // (Stellar Wallets Kit) to sign. ---

  app.post<{ Body: { donorPublicKey: string; tierId: string; region?: string; currency?: string } }>(
    "/sponsorships",
    async (request, reply) => {
      const { donorPublicKey, tierId, region, currency } = request.body ?? {};
      if (!donorPublicKey || !tierId) {
        return reply.status(400).send({ error: "donorPublicKey and tierId are required" });
      }
      try {
        const result = await createSponsorshipBatch({ donorPublicKey, tierId, region, currency });
        return reply.status(201).send({ ...result, networkPassphrase: config.networkPassphrase });
      } catch (err) {
        return reply.status(502).send({ error: err instanceof Error ? err.message : "Deploy failed" });
      }
    },
  );

  app.post<{ Params: { unitId: string }; Body: { signedXdr: string } }>(
    "/sponsorships/units/:unitId/submit-deploy",
    async (request, reply) => {
      const { signedXdr } = request.body ?? {};
      if (!signedXdr) return reply.status(400).send({ error: "signedXdr is required" });
      try {
        const result = await submitUnitDeploy({ unitId: request.params.unitId, signedXdr });
        return { fundXdr: result.fundXdr, networkPassphrase: config.networkPassphrase };
      } catch (err) {
        return reply.status(502).send({ error: err instanceof Error ? err.message : "Submit failed" });
      }
    },
  );

  app.post<{ Params: { unitId: string }; Body: { signedXdr: string } }>(
    "/sponsorships/units/:unitId/submit-fund",
    async (request, reply) => {
      const { signedXdr } = request.body ?? {};
      if (!signedXdr) return reply.status(400).send({ error: "signedXdr is required" });
      try {
        await submitUnitFunding({ unitId: request.params.unitId, signedXdr });
        return { funded: true };
      } catch (err) {
        return reply.status(502).send({ error: err instanceof Error ? err.message : "Submit failed" });
      }
    },
  );

  // --- Demo "claim a sponsored meal" surface — first-come-first-served,
  // explicitly disclosed as a demo simplification (see
  // docs/BUILDATHON-PLAN.md): the real product gates this through
  // verified NGOs/beneficiaries, not any customer. ---

  app.get<{ Querystring: { region?: string } }>("/sponsorships/availability", async (request) => {
    const available = await hasAvailableSponsorshipUnit({ region: request.query?.region });
    return { available };
  });

  app.post<{ Body: { region?: string } }>("/sponsorships/claim", async (request, reply) => {
    const claimed = await claimSponsorshipUnit({ region: request.body?.region });
    if (!claimed) {
      return reply.status(404).send({ error: "No available sponsored meals right now" });
    }
    return claimed;
  });

  // --- Called by the real Eatovr backend once a claimed credit is
  // actually redeemed at checkout against a real listing — see
  // sponsorship/service.ts's `attachOrderToUnit` doc comment. ---

  app.post<{ Params: { unitId: string }; Body: { orderId: string } }>(
    "/sponsorships/units/:unitId/attach-order",
    async (request, reply) => {
      const { orderId } = request.body ?? {};
      if (!orderId) return reply.status(400).send({ error: "orderId is required" });
      try {
        await attachOrderToUnit({ unitId: request.params.unitId, orderId });
        return { attached: true };
      } catch (err) {
        return reply.status(409).send({ error: err instanceof Error ? err.message : "Attach failed" });
      }
    },
  );
}
