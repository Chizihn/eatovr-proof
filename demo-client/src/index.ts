import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

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

  console.log("\n1. Vendor claims a pickup...");
  const claimPrepare = await postJson<{ xdr: string }>("/pickups/claim/prepare", {
    vendorPublicKey: vendor.publicKey(),
    recipientPublicKey: recipient.publicKey(),
    itemType: "rice_and_stew_trays",
    quantity: 8,
  });

  const claimSigned = signLocally(claimPrepare.xdr, vendor);
  const claimResult = await postJson<{ hash: string; returnValue?: string }>(
    "/transactions/submit",
    { xdr: claimSigned },
  );

  const claimId = claimResult.returnValue;
  if (!claimId) {
    throw new Error("Did not get a claim id back from claim_pickup");
  }
  console.log(`   claimed. claim_id=${claimId}  tx=${claimResult.hash}`);

  console.log("\n2. Recipient independently confirms it...");
  const confirmPrepare = await postJson<{ xdr: string }>(
    `/pickups/${claimId}/confirm/prepare`,
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
    const row = await getJson<{ status: string }>(`/pickups/${claimId}`).catch(() => null);
    if (row?.status === "Finalized") {
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
