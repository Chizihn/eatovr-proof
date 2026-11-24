import { Keypair } from "@stellar/stellar-sdk";
import { PulseClient } from "@reflector/contract-client";
import { config } from "../config.js";

/**
 * Reflector's real, verified client (`@reflector/contract-client`
 * v2.2.0, class `PulseClient`) — confirmed live against testnet with
 * a funded keypair, not built from docs prose alone.
 *
 * Reflector's Fiat FX feed (CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W)
 * has **no NGN pair at all** — verified live: its `assets()` list is
 * EUR/GBP/CHF/CAD/MXN/ARS/BRL/THB/XAU only. So this deliberately does
 * NOT call that feed for a naira conversion (it would always return
 * `null`). The NGN->USD leg is instead a fixed, explicitly-labeled
 * demo rate — see sponsorship/tiers.ts.
 *
 * What this *does* call for real is the CEX/DEX feed's `lastPrice`
 * for USDC, which genuinely has a USDC/USD pair — a real oracle read,
 * surfaced on the dashboard, not decoration.
 */
export async function readUsdcUsdPrice(): Promise<{ price: string; timestamp: number } | null> {
  // Read-only simulation call — no signing happens, but the client
  // still needs *some* account to simulate from. The sponsor key is
  // already funded on testnet for this service's other purposes.
  const publicKey = Keypair.fromSecret(config.sponsorSecret).publicKey();

  const client = new PulseClient({
    publicKey,
    rpcUrl: config.sorobanRpcUrl,
    networkPassphrase: config.networkPassphrase,
    contractId: config.reflectorCexDexContractId,
  });

  const result = await client.lastPrice("USDC");
  if (!result) return null;

  const decimals = await client.decimals();
  const price = (Number(result.price) / 10 ** decimals).toFixed(6);

  return { price, timestamp: Number(result.timestamp) };
}
