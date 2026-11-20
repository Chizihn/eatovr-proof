export type Attestation = {
  claimId: string;
  vendor: string;
  recipient: string;
  itemType: string;
  quantity: number;
  status: "Pending" | "Finalized";
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

export function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
