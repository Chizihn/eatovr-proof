import { config } from "../config.js";

/**
 * Trustless Work's real v1 REST API (dev.api.trustlesswork.com) —
 * verified against their actual docs *and* a live request on
 * 2026-11-24, not built against docs/BUILDATHON-PLAN.md's sketch or
 * the v2 beta API literally. The BackOffice-issued testnet API key
 * only authenticates against this v1 host — `beta.api.trustlesswork.com`
 * (the v2 Core API) returns 401 for it even though the route shapes
 * looked plausible; the v1 docs' `/helper/get-escrows-by-signer`
 * returned a real 200 with the same key, confirming this is the right
 * host for this credential.
 *
 * Deliberately a plain `fetch` wrapper, not their `@trustless-work/escrow`
 * npm package — that package is a React-hooks client meant for a
 * browser app, the wrong fit for this Fastify backend.
 *
 * Every mutating call here returns an *unsigned* transaction (base64
 * XDR, field name `unsignedTransaction`) that the relevant party signs
 * with their own key — this service never holds a donor's key.
 * Submission itself also goes through Trustless Work's own
 * `/helper/send-transaction`, not this service's own Soroban RPC
 * connection — their indexer needs to see the submission to track the
 * escrow's state.
 *
 * Single-release escrows pay their *one* fixed receiver only once
 * every milestone is approved, and there's no refund/cancel-on-expiry
 * endpoint (only a dispute -> resolve-dispute path) — see
 * schema.prisma's `SponsorshipBatch` doc comment for why this means
 * one escrow per *unit*, not one per batch.
 */

function requireApiKey(): string {
  if (!config.trustlessWorkApiKey) {
    throw new Error(
      "TRUSTLESS_WORK_API_KEY is not set — request one at backoffice.trustlesswork.com " +
        "(log in with a Stellar wallet, fill in a Use Case, choose testnet) before using Sponsor Food.",
    );
  }
  return config.trustlessWorkApiKey;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.trustlessWorkBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": requireApiKey(),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Trustless Work ${path} failed (${response.status}): ${JSON.stringify(data)}`,
    );
  }
  return data as T;
}

/**
 * Deploys a single-release escrow for exactly one sponsorship unit.
 * `receiver`/`approver`/`serviceProvider`/`releaseSigner`/
 * `disputeResolver` are all the platform settlement address (not the
 * donor, not the eventual vendor — the vendor isn't known until a
 * customer claims this unit). `signer` is the donor's own connected
 * wallet address; they sign the returned `unsignedTransaction`
 * client-side via Stellar Wallets Kit.
 *
 * `trustlineIssuer` must be the asset's **issuer address** (`G...`),
 * not its Stellar Asset Contract id (`C...`) — confirmed from
 * Trustless Work's own integration guidance, a real gotcha their docs
 * call out explicitly.
 */
export async function deployUnitEscrow(params: {
  engagementId: string;
  donorPublicKey: string;
  platformPublicKey: string;
  amountUsdc: string;
  trustlineIssuer: string;
}): Promise<{ unsignedTransaction: string }> {
  return post<{ unsignedTransaction: string }>("/deployer/single-release", {
    signer: params.donorPublicKey,
    engagementId: params.engagementId,
    title: "Eatovr Sponsor Food — one sponsored meal",
    description:
      "One discrete sponsored-meal unit, released to Eatovr's platform settlement address once the recipient and vendor independently confirm the pickup on-chain.",
    roles: {
      approver: params.platformPublicKey,
      serviceProvider: params.platformPublicKey,
      platformAddress: params.platformPublicKey,
      releaseSigner: params.platformPublicKey,
      disputeResolver: params.platformPublicKey,
      receiver: params.platformPublicKey,
    },
    amount: Number(params.amountUsdc),
    platformFee: 0,
    trustline: { address: params.trustlineIssuer, symbol: "USDC" },
    milestones: [{ description: "Pickup independently confirmed by vendor and recipient" }],
  });
}

export async function fundUnitEscrow(params: {
  contractId: string;
  donorPublicKey: string;
  amountUsdc: string;
}): Promise<{ unsignedTransaction: string }> {
  return post<{ unsignedTransaction: string }>("/escrow/single-release/fund-escrow", {
    contractId: params.contractId,
    signer: params.donorPublicKey,
    amount: Number(params.amountUsdc),
  });
}

/**
 * Release requires the escrow's one milestone to be marked
 * `completed` (by the `serviceProvider` role) and then approved (by
 * the `approver` role) first — confirmed live: calling release-funds
 * before this returns 400 "The escrow must be completed to release
 * earnings". Both roles are the platform address in this design (see
 * `deployUnitEscrow`), so the indexer can do all three steps
 * unilaterally once the on-chain pickup finalizes — no second
 * approval from anyone else.
 */
export async function completeUnitMilestone(params: {
  contractId: string;
  platformPublicKey: string;
  evidence: string;
}): Promise<{ unsignedTransaction: string }> {
  return post<{ unsignedTransaction: string }>("/escrow/single-release/change-milestone-status", {
    contractId: params.contractId,
    milestoneIndex: "0",
    newStatus: "completed",
    newEvidence: params.evidence,
    serviceProvider: params.platformPublicKey,
  });
}

export async function approveUnitMilestone(params: {
  contractId: string;
  platformPublicKey: string;
}): Promise<{ unsignedTransaction: string }> {
  return post<{ unsignedTransaction: string }>("/escrow/single-release/approve-milestone", {
    contractId: params.contractId,
    milestoneIndex: "0",
    approver: params.platformPublicKey,
  });
}

/**
 * Called by the indexer (see indexer/run.ts) when a sponsorship
 * unit's order finalizes on-chain. Returns an unsigned transaction
 * that the platform settlement key signs and submits — not a
 * server-side-only call, Trustless Work itself requires a wallet
 * signature for release too.
 */
export async function releaseUnitFunds(params: {
  contractId: string;
  platformPublicKey: string;
}): Promise<{ unsignedTransaction: string }> {
  return post<{ unsignedTransaction: string }>("/escrow/single-release/release-funds", {
    contractId: params.contractId,
    releaseSigner: params.platformPublicKey,
  });
}

/**
 * Every signed transaction from the three calls above gets submitted
 * through *this* endpoint, not this service's own Soroban RPC
 * connection — Trustless Work's own indexer needs to observe the
 * submission to track the escrow's state.
 */
export async function sendSignedTransaction(signedXdr: string): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>("/helper/send-transaction", { signedXdr });
}
