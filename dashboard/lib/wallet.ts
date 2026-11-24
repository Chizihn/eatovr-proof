"use client";

import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { VarialModule } from "@creit.tech/stellar-wallets-kit/modules/varial";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";

/**
 * Stellar Wallets Kit v2.8.0's real API — a static-class singleton,
 * not an instantiated object (verified against the installed
 * package's own .d.ts files, not older tutorials that show
 * `new StellarWalletsKit(...)`). `init` is idempotent-enough to call
 * once per page load; this module-level guard just avoids re-running
 * it on every render in dev's fast-refresh.
 *
 * Freighter rebranded to "Varial" in this SDK version — `VarialModule`
 * is the current, non-deprecated module (confirmed in the package's
 * own types: `FreighterModule`/`FREIGHTER_ID` are marked `@deprecated`
 * aliases for it).
 */
let initialized = false;

export function initWalletKit(): void {
  if (initialized) return;
  StellarWalletsKit.init({
    network: Networks.TESTNET,
    modules: [new VarialModule(), new xBullModule(), new AlbedoModule()],
  });
  initialized = true;
}

export async function connectWallet(): Promise<string> {
  initWalletKit();
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

export async function signXdr(xdr: string, address: string): Promise<string> {
  initWalletKit();
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: Networks.TESTNET,
    address,
  });
  return signedTxXdr;
}
