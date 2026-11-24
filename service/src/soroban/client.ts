import {
  rpc,
  Contract,
  Transaction,
  FeeBumpTransaction,
  TransactionBuilder,
  Address,
  nativeToScVal,
  scValToNative,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { withRetry } from "./retry.js";

export const sorobanServer = new rpc.Server(config.sorobanRpcUrl);
export const attestationContract = new Contract(config.contractId);

/**
 * Submits an already-signed transaction and waits for it to land.
 * Shared by both the self-funded flow (`submitSignedTransaction`, the
 * caller's own account pays its own fee) and the relayer (`relayer.ts`,
 * for passkey wallets that don't hold XLM to pay a fee themselves).
 */
export async function submitAndWait(tx: Transaction | FeeBumpTransaction): Promise<{
  status: string;
  hash: string;
  returnValue?: unknown;
}> {
  const sendResult = await sorobanServer.sendTransaction(tx);

  if (sendResult.status === "ERROR") {
    throw new Error(`Transaction submission failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const hash = sendResult.hash;

  let getResult = await sorobanServer.getTransaction(hash);
  const deadline = Date.now() + 30_000;
  while (
    getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    getResult = await sorobanServer.getTransaction(hash);
  }

  if (getResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction did not succeed: ${getResult.status}`);
  }

  const returnValue = getResult.returnValue ? scValToNative(getResult.returnValue) : undefined;

  return { status: getResult.status, hash, returnValue };
}

async function buildAndPrepare(sourcePublicKey: string, operation: ReturnType<Contract["call"]>) {
  const sourceAccount = await withRetry(() => sorobanServer.getAccount(sourcePublicKey));

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const prepared = await withRetry(() => sorobanServer.prepareTransaction(tx));
  return prepared.toXDR();
}

/**
 * Builds an unsigned `claim_pickup` transaction with the vendor as the
 * transaction source (so the vendor's own signature satisfies the
 * contract's `vendor.require_auth()`). The caller signs this XDR with
 * the vendor's key and posts it to `/pickups/claim/submit` — this
 * service never sees or holds a vendor/recipient private key.
 *
 * `orderId` is Eatovr's own order id (the contract's `DataKey::Claim`
 * key — see contracts/attestation-registry/src/lib.rs), not an
 * on-chain-minted id.
 */
export async function buildClaimPickupTx(params: {
  orderId: string;
  vendorPublicKey: string;
  recipientPublicKey: string;
  itemType: string;
  quantity: number;
}): Promise<string> {
  const operation = attestationContract.call(
    "claim_pickup",
    nativeToScVal(params.orderId, { type: "string" }),
    new Address(params.vendorPublicKey).toScVal(),
    new Address(params.recipientPublicKey).toScVal(),
    nativeToScVal(params.itemType, { type: "string" }),
    nativeToScVal(params.quantity, { type: "u32" }),
  );

  return buildAndPrepare(params.vendorPublicKey, operation);
}

/**
 * Builds an unsigned `confirm_pickup` transaction with the recipient as
 * the transaction source, mirroring `buildClaimPickupTx` for the other
 * party in the two-party flow. `orderId` already exists at checkout —
 * this can be built and signed before `claim_pickup` ever runs; see
 * `routes/pickups.ts`'s `/pickups/:orderId/pre-confirm` for the
 * deferred-submission path that relies on that.
 */
export async function buildConfirmPickupTx(params: {
  orderId: string;
  recipientPublicKey: string;
}): Promise<string> {
  const operation = attestationContract.call(
    "confirm_pickup",
    nativeToScVal(params.orderId, { type: "string" }),
    new Address(params.recipientPublicKey).toScVal(),
  );

  return buildAndPrepare(params.recipientPublicKey, operation);
}

/**
 * Submits a transaction the caller has already signed locally, and
 * waits for it to land. The indexer (not this function) is what
 * actually updates the read model — this just reports whether the
 * chain accepted it.
 */
export async function submitSignedTransaction(signedXdr: string): Promise<{
  status: string;
  hash: string;
  returnValue?: unknown;
}> {
  const tx = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
  return submitAndWait(tx);
}
