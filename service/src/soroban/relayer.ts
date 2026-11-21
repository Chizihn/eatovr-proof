import {
  rpc,
  xdr,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { sorobanServer, submitAndWait } from "./client.js";
import { withRetry } from "./retry.js";

/**
 * Pays network fees on behalf of passkey-controlled smart wallets,
 * which don't hold XLM themselves — see
 * docs/PASSKEY_ATTESTATION_INTEGRATION_PLAN.md in the Eatovr repo.
 * This key has no authority over any attestation; it only ever pays
 * transaction fees, matching the plain HTTP "relayer" contract
 * smart-account-kit expects:
 *   GET  /        health check
 *   POST /        { func: base64, auth: base64[] }  OR  { xdr: base64 }
 *   GET  /status  network/caller info
 */
const sponsorKeypair = Keypair.fromSecret(config.sponsorSecret);

/**
 * The caller already assembled a complete, signed transaction (e.g.
 * the inner transaction's own source account signed it) — we only
 * need to pay the fee, via a fee-bump envelope that doesn't disturb
 * the inner transaction's own signatures/auth.
 */
export async function relaySignedXdr(signedXdr: string): Promise<{
  status: string;
  hash: string;
}> {
  const inner = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
  if (!(inner instanceof Transaction)) {
    throw new Error("Expected a signed Transaction, not a fee-bump transaction");
  }

  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    sponsorKeypair,
    BASE_FEE,
    inner,
    config.networkPassphrase,
  );
  feeBump.sign(sponsorKeypair);

  return submitAndWait(feeBump);
}

/**
 * The caller has a signed Soroban authorization (e.g. a passkey
 * wallet's `__check_auth`-satisfying auth entry) but no funded account
 * to build a transaction from — we build the transaction ourselves,
 * as the fee-paying source, wrapping their pre-signed authorization.
 */
export async function relayFuncAndAuth(
  funcB64: string,
  authB64: string[],
): Promise<{ status: string; hash: string }> {
  const func = xdr.HostFunction.fromXDR(funcB64, "base64");
  const auth = authB64.map((entry) => xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64"));

  const sourceAccount = await withRetry(() =>
    sorobanServer.getAccount(sponsorKeypair.publicKey()),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(60)
    .build();

  // The transaction already carries real authorization entries from the
  // caller — simulate in "enforce" mode (validate what's there) rather
  // than the default "record" mode (which would try to generate new,
  // sponsor-signed auth instead of respecting the caller's own).
  const simulation = await withRetry(() =>
    sorobanServer.simulateTransaction(tx, undefined, "enforce"),
  );
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }

  const prepared = rpc.assembleTransaction(tx, simulation).build();
  prepared.sign(sponsorKeypair);

  return submitAndWait(prepared);
}
