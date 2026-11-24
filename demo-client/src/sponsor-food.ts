import { randomUUID } from "node:crypto";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:3900";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Export it from your own shell (e.g. ` +
        `DONOR_SECRET=$(stellar keys secret demo-donor)) — never paste a secret key ` +
        `anywhere else, including to an AI assistant.`,
    );
  }
  return value;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${SERVICE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data as T;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${SERVICE_URL}${path}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data as T;
}

/**
 * Stands in for Stellar Wallets Kit's `signTransaction` the same way
 * `index.ts`'s `signLocally` stands in for a passkey wallet — a raw
 * secret key here, a browser extension wallet for a real donor.
 */
function signLocally(xdr: string, signer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  tx.sign(signer);
  return tx.toXDR();
}

/**
 * Proves Sponsor Food end to end on testnet: a donor funds a
 * 1-meal batch (one Trustless Work escrow, deployed then funded),
 * a customer claims it through the demo "claim a sponsored meal"
 * surface, the normal unmodified claim_pickup/confirm_pickup flow
 * finalizes it, and the indexer releases the escrow automatically —
 * see docs/BUILDATHON-PLAN.md's Sponsor Food section and
 * schema.prisma's SponsorshipBatch doc comment for the full design.
 *
 * Requires TRUSTLESS_WORK_API_KEY and PLATFORM_SECRET to be set on
 * the Attestation Service (see service/.env.example) — request a key
 * at backoffice.trustlesswork.com first if you haven't.
 */
async function main() {
  const donor = Keypair.fromSecret(requireEnv("DONOR_SECRET"));
  const vendor = Keypair.fromSecret(requireEnv("VENDOR_SECRET"));
  const recipient = Keypair.fromSecret(requireEnv("RECIPIENT_SECRET"));

  console.log(`donor:     ${donor.publicKey()}`);
  console.log(`vendor:    ${vendor.publicKey()}`);
  console.log(`recipient: ${recipient.publicKey()}`);

  console.log("\n1. Donor sponsors 1 meal — deploying its escrow...");
  const created = await postJson<{
    batchId: string;
    units: { unitId: string; index: number; deployXdr: string }[];
  }>("/sponsorships", { donorPublicKey: donor.publicKey(), tierId: "1" });
  console.log(`   batch: ${created.batchId}`);

  for (const unit of created.units) {
    console.log(`\n2. Donor signs & submits the deploy transaction for unit ${unit.index}...`);
    const signedDeploy = signLocally(unit.deployXdr, donor);
    const deployed = await postJson<{ fundXdr: string }>(
      `/sponsorships/units/${unit.unitId}/submit-deploy`,
      { signedXdr: signedDeploy },
    );

    console.log("   donor signs & submits the fund transaction...");
    const signedFund = signLocally(deployed.fundXdr, donor);
    await postJson(`/sponsorships/units/${unit.unitId}/submit-fund`, { signedXdr: signedFund });
    console.log("   escrow funded.");
  }

  console.log("\n3. A customer claims the sponsored meal (demo claim surface)...");
  const claimed = await postJson<{ orderId: string }>("/sponsorships/claim", {});
  console.log(`   claimed as order ${claimed.orderId}`);

  console.log("\n4. Normal pickup flow — vendor claims, recipient confirms...");
  const claimPrepare = await postJson<{ xdr: string }>(
    `/pickups/${claimed.orderId}/claim/prepare`,
    {
      vendorPublicKey: vendor.publicKey(),
      recipientPublicKey: recipient.publicKey(),
      itemType: "sponsored_meal",
      quantity: 1,
    },
  );
  await postJson("/transactions/submit", { xdr: signLocally(claimPrepare.xdr, vendor) });

  const confirmPrepare = await postJson<{ xdr: string }>(
    `/pickups/${claimed.orderId}/confirm/prepare`,
    { recipientPublicKey: recipient.publicKey() },
  );
  await postJson("/transactions/submit", { xdr: signLocally(confirmPrepare.xdr, recipient) });
  console.log("   finalized on-chain.");

  console.log("\n5. Waiting for the indexer to release the escrow automatically...");
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const batch = await getJson<{
      units: { id: string; status: string; releaseTxHash: string | null }[];
    }>(`/sponsorships/${created.batchId}`).catch(() => null);
    const unit = batch?.units.find((u) => u.id === created.units[0]?.unitId);
    if (unit?.status === "Redeemed") {
      console.log(`   released automatically — no donor or platform action after step 2-3. release tx=${unit.releaseTxHash}`);
      return;
    }
  }
  console.log("   still not Redeemed after 30s — check the service logs for '[sponsorship] release failed'.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
