const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:3900";

/** Mirrors service/prisma/schema.prisma's `SponsorshipUnitStatus` enum — see lib/attestations.ts's `AttestationStatus` comment for why this is a hand-kept mirror, not a shared type. */
export const SponsorshipUnitStatus = {
  Pending: "Pending",
  Available: "Available",
  Claimed: "Claimed",
  Redeemed: "Redeemed",
} as const;
export type SponsorshipUnitStatus = (typeof SponsorshipUnitStatus)[keyof typeof SponsorshipUnitStatus];

/** Mirrors service/prisma/schema.prisma's `SponsorshipBatchStatus` enum. */
export const SponsorshipBatchStatus = {
  Funding: "Funding",
  Active: "Active",
  Depleted: "Depleted",
} as const;
export type SponsorshipBatchStatus = (typeof SponsorshipBatchStatus)[keyof typeof SponsorshipBatchStatus];

export type SponsorshipUnit = {
  id: string;
  index: number;
  status: SponsorshipUnitStatus;
  escrowContractId: string | null;
  fundingTxHash: string | null;
  releaseTxHash: string | null;
  claimedOrderId: string | null;
};

export type SponsorshipBatch = {
  id: string;
  donor: string;
  region: string | null;
  unitCount: number;
  unitValueUsdc: string;
  reflectorUsdPrice: string | null;
  status: SponsorshipBatchStatus;
  createdAt: string;
  available: number;
  claimed: number;
  redeemed: number;
  units: SponsorshipUnit[];
};

export type SponsorshipTier = { id: string; unitCount: number; label: string };

/** Same read-the-service's-own-read-model pattern as getAttestations. */
export async function getSponsorshipBatches(): Promise<SponsorshipBatch[]> {
  const response = await fetch(`${SERVICE_URL}/sponsorships`, {
    next: { revalidate: 15 },
  });
  if (!response.ok) {
    throw new Error(`Attestation Service responded with ${response.status}`);
  }
  return response.json();
}

export async function getSponsorshipTiers(): Promise<SponsorshipTier[]> {
  const response = await fetch(`${SERVICE_URL}/sponsorships/tiers`, {
    next: { revalidate: 3600 },
  });
  if (!response.ok) {
    throw new Error(`Attestation Service responded with ${response.status}`);
  }
  return response.json();
}
