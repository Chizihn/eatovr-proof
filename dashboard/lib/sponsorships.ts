const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:3900";

export type SponsorshipUnit = {
  id: string;
  index: number;
  status: "Pending" | "Available" | "Claimed" | "Redeemed";
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
  status: "Funding" | "Active" | "Depleted";
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
