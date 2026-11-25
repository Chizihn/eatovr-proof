import { randomUUID } from "node:crypto";
import {
  Address,
  authorizeEntry,
  Keypair,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { AttestationStatus } from "./constants.js";

const SERVICE_URL = process.env.SERVICE_URL ?? "http://localhost:3900";
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT_ID = process.env.CONTRACT_ID;

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
 * Builds the `confirm_pickup(order_id, recipient)` invocation as a raw
 * HostFunction + a *signed* SorobanAuthorizationEntry for `recipient` —
 * the same shape `relayFuncAndAuth` (service/src/soroban/relayer.ts)
 * already accepts, and the same shape a passkey wallet's
 * `kit.execute()` + `kit.signAdmin()` produces for a real app (see
 * docs/PASSKEY_ATTESTATION_INTEGRATION_PLAN.md's deferred-confirm
 * section). This stands in for that passkey signing step with a plain
 * keypair, same as `index.ts` already does for the direct-submit flow.
 *
 * The whole point: this can be built and signed for `orderId` before
 * `claim_pickup` ever runs — `orderId` is all it needs, and that
 * already exists at checkout.
 */
async function buildSignedConfirmAuth(params: {
  server: rpc.Server;
  contractId: string;
  orderId: string;
  recipient: Keypair;
}): Promise<{ funcXdr: string; authXdr: string }> {
  const { server, contractId, orderId, recipient } = params;

  const args = [
    nativeToScVal(params.orderId, { type: "string" }),
    new Address(recipient.publicKey()).toScVal(),
  ];

  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: new Address(contractId).toScAddress(),
    functionName: "confirm_pickup",
    args,
  });

  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs);

  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });

  // Generous validity window — this needs to still be valid whenever
  // the vendor eventually claims and the indexer submits this, which
  // could be hours after checkout. ~1 day of testnet ledgers (~5s each).
  const latestLedger = await server.getLatestLedger();
  const signatureExpirationLedger = latestLedger.sequence + 17_280;

  const nonce = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  const unsignedEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(recipient.publicKey()).toScAddress(),
        nonce: xdr.Int64.fromString(nonce.toString()),
        signatureExpirationLedger,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation,
  });

  const signedEntry = await authorizeEntry(
    unsignedEntry,
    recipient,
    signatureExpirationLedger,
    NETWORK_PASSPHRASE,
  );

  return {
    funcXdr: func.toXDR("base64"),
    authXdr: signedEntry.toXDR("base64"),
  };
}

async function main() {
  if (!CONTRACT_ID) {
    throw new Error("Missing required env var CONTRACT_ID (the AttestationRegistry contract id)");
  }

  const vendor = Keypair.fromSecret(requireEnv("VENDOR_SECRET"));
  const recipient = Keypair.fromSecret(requireEnv("RECIPIENT_SECRET"));
  const orderId = `demo-deferred-${randomUUID()}`;

  console.log(`vendor:    ${vendor.publicKey()}`);
  console.log(`recipient: ${recipient.publicKey()}`);
  console.log(`order:     ${orderId}`);

  const server = new rpc.Server(SOROBAN_RPC_URL);

  console.log(
    "\n1. Recipient signs confirm_pickup NOW, at (simulated) checkout — before the vendor has claimed anything...",
  );
  const { funcXdr, authXdr } = await buildSignedConfirmAuth({
    server,
    contractId: CONTRACT_ID,
    orderId,
    recipient,
  });

  await postJson(`/pickups/${orderId}/pre-confirm`, {
    recipientPublicKey: recipient.publicKey(),
    func: funcXdr,
    auth: [authXdr],
  });
  console.log("   signed and stored, unsubmitted. Recipient's part is done — for good.");

  console.log(
    "\n2. Some time later, the vendor claims the pickup (the only action left for anyone to take)...",
  );
  const claimPrepare = await postJson<{ xdr: string }>(`/pickups/${orderId}/claim/prepare`, {
    vendorPublicKey: vendor.publicKey(),
    recipientPublicKey: recipient.publicKey(),
    itemType: "deferred_confirm_demo_meal",
    quantity: 1,
  });

  const { TransactionBuilder } = await import("@stellar/stellar-sdk");
  const claimTx = TransactionBuilder.fromXDR(claimPrepare.xdr, NETWORK_PASSPHRASE);
  claimTx.sign(vendor);
  const claimResult = await postJson<{ hash: string }>("/transactions/submit", {
    xdr: claimTx.toXDR(),
  });
  console.log(`   claimed. tx=${claimResult.hash}`);

  console.log(
    "\n3. Waiting for the indexer to see the claim and auto-submit the recipient's stored confirmation...",
  );
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const row = await getJson<{ status: AttestationStatus; confirmTxHash?: string }>(
      `/pickups/${orderId}`,
    ).catch(() => null);
    if (row?.status === AttestationStatus.Finalized) {
      console.log(
        `   Finalized automatically — no recipient action after step 1. confirm tx=${row.confirmTxHash}`,
      );
      return;
    }
  }
  console.log(
    "   still not Finalized after 30s — check the service logs for '[indexer] deferred confirm_pickup submit failed'.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
