/**
 * Mirrors service/prisma/schema.prisma's `AttestationStatus` enum —
 * not type-shared (the dashboard only talks to the service over
 * HTTP, it doesn't depend on the service's generated Prisma client),
 * so these have to be kept in sync by hand if the service's enum
 * ever changes.
 */
export const AttestationStatus = {
  Pending: "Pending",
  Finalized: "Finalized",
} as const;
export type AttestationStatus = (typeof AttestationStatus)[keyof typeof AttestationStatus];

/** Mirrors service/prisma/schema.prisma's `OrderCategory` enum — see `AttestationStatus`'s comment above. */
export const OrderCategory = {
  commercial: "commercial",
  donation_recovery: "donation_recovery",
} as const;
export type OrderCategory = (typeof OrderCategory)[keyof typeof OrderCategory];

export type Attestation = {
  orderId: string;
  vendor: string;
  recipient: string;
  itemType: string;
  quantity: number;
  status: AttestationStatus;
  region: string | null;
  category: OrderCategory;
  claimedAt: string;
  confirmedAt: string | null;
  claimTxHash: string;
  confirmTxHash: string | null;
};

const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:3900";

/**
 * Reads the Attestation Service's read model directly — this is the
 * same data the service's indexer wrote from on-chain events, not
 * anything Eatovr self-reports.
 */
export async function getAttestations(): Promise<Attestation[]> {
  const response = await fetch(`${SERVICE_URL}/pickups`, {
    next: { revalidate: 15 },
  });

  if (!response.ok) {
    throw new Error(`Attestation Service responded with ${response.status}`);
  }

  return response.json();
}

export function stellarExpertTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function stellarExpertContractUrl(contractId: string): string {
  return `https://stellar.expert/explorer/testnet/contract/${contractId}`;
}

// The deployed AttestationRegistry — order-id-keyed (see
// contracts/attestation-registry), not something the Attestation
// Service's API exposes, so it's a constant here rather than fetched.
export const ATTESTATION_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ATTESTATION_CONTRACT_ID ??
  "CDII3ONLMNCEYTVO77V2X5WAZRAPBIJRYFGCETQ42X62CDXJGDKGUH2R";

export function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
