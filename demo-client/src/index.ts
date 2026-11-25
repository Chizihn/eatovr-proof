import { randomUUID } from "node:crypto";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { AttestationStatus, OrderCategory } from "./constants.js";

const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:3900";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Export it from your own shell (e.g. ` +
        `VENDOR_SECRET=$(stellar keys secret vendor)) — never paste a secret key ` +
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
 * This is the one step a real passkey wallet would do differently: it
 * would sign with a biometric-gated hardware key, not a raw secret in
 * an env var. Everything else here — asking the service to prepare a
 * transaction, signing it locally, and posting the signed result back
 * — is exactly the shape the real app's confirm flow will use.
 */
function signLocally(xdr: string, signer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  tx.sign(signer);
  return tx.toXDR();
}

async function main() {
  const vendor = Keypair.fromSecret(requireEnv("VENDOR_SECRET"));
  const recipient = Keypair.fromSecret(requireEnv("RECIPIENT_SECRET"));

  console.log(`vendor:    ${vendor.publicKey()}`);
  console.log(`recipient: ${recipient.publicKey()}`);

  // `orderId` is Eatovr's own order id in the real app — the contract
  // (and this service) key everything off it now, not an on-chain-minted
  // id, specifically so a recipient's confirm can be signed before the
  // vendor ever claims (see `deferred-confirm.ts` for that path). A
  // random id stands in for a real order here.
  const orderId = `demo-order-${randomUUID()}`;
  console.log(`order: ${orderId}`);

  // Region/category are descriptive metadata, not part of any
  // on-chain auth check — neither the contract nor the `claimed`
  // event carries them. REGION/CATEGORY let this script demonstrate
  // the dashboard's filters with real, varied data instead of every
  // demo order looking identical. Optional: a plain `npm start` still
  // works with neither set.
  const region = process.env.REGION;
  const category = process.env.CATEGORY as OrderCategory | undefined;
  if (region || category) {
    console.log(`\n0. Attaching metadata (region=${region ?? "—"}, category=${category ?? OrderCategory.commercial})...`);
    await postJson(`/pickups/${orderId}/metadata`, { region, category });
  }

  console.log("\n1. Vendor claims a pickup...");
  const claimPrepare = await postJson<{ xdr: string }>(`/pickups/${orderId}/claim/prepare`, {
    vendorPublicKey: vendor.publicKey(),
    recipientPublicKey: recipient.publicKey(),
    itemType: "rice_and_stew_trays",
    quantity: 8,
  });

  const claimSigned = signLocally(claimPrepare.xdr, vendor);
  const claimResult = await postJson<{ hash: string }>("/transactions/submit", {
    xdr: claimSigned,
  });
  console.log(`   claimed. tx=${claimResult.hash}`);

  console.log("\n2. Recipient independently confirms it...");
  const confirmPrepare = await postJson<{ xdr: string }>(
    `/pickups/${orderId}/confirm/prepare`,
    { recipientPublicKey: recipient.publicKey() },
  );

  const confirmSigned = signLocally(confirmPrepare.xdr, recipient);
  const confirmResult = await postJson<{ hash: string }>("/transactions/submit", {
    xdr: confirmSigned,
  });
  console.log(`   confirmed. tx=${confirmResult.hash}`);

  console.log("\n3. Waiting for the indexer to pick it up in the read model...");
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const row = await getJson<{ status: AttestationStatus }>(`/pickups/${orderId}`).catch(() => null);
    if (row?.status === AttestationStatus.Finalized) {
      console.log("   read model shows Finalized:", row);
      return;
    }
  }
  console.log("   still not Finalized in the read model after 20s — check the service logs.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
