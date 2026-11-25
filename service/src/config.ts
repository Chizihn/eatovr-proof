import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export type StellarNetwork = "testnet" | "mainnet";

const network = (process.env.STELLAR_NETWORK ?? "testnet") as StellarNetwork;
if (network !== "testnet" && network !== "mainnet") {
  throw new Error(`STELLAR_NETWORK must be "testnet" or "mainnet", got "${network}"`);
}

/**
 * Only testnet has defaults worth baking in. Stellar has no official
 * public mainnet Soroban RPC at all (SDF only runs one for testnet —
 * mainnet means picking a third-party provider yourself), and even
 * Reflector's own mainnet CEX/DEX oracle address is ambiguous across
 * their own public docs as of this writing (confirmed by cross-
 * checking multiple sources — they disagree with each other). Baking
 * in a guessed mainnet value here would be the exact kind of
 * unverified assumption this project's own rule says never to make
 * about a Stellar ecosystem protocol, and here it's real money.
 *
 * So: flipping `STELLAR_NETWORK` to "mainnet" does NOT swap in a
 * parallel set of mainnet defaults. It removes every testnet default
 * below and requires you to set each one explicitly, verified against
 * that protocol's own current docs at the time — see `networkValue`.
 */
const TESTNET_DEFAULTS = {
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  trustlessWorkBaseUrl: "https://dev.api.trustlesswork.com",
  reflectorCexDexContractId: "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63",
  // Derived via `stellar contract id asset --asset
  // "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  // --network testnet`, not guessed.
  usdcContractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

/**
 * Resolves a Stellar-network-dependent value: the env var if set,
 * else the known-good testnet default if `network` is testnet, else
 * a hard failure — never a silent fall-through to a testnet value
 * while pointed at mainnet, which is the one way this class of
 * config mistake becomes a real-money bug instead of a loud one.
 */
function networkValue(envVar: string, testnetDefault: string): string {
  const value = process.env[envVar];
  if (value) return value;
  if (network === "testnet") return testnetDefault;
  throw new Error(
    `${envVar} must be set explicitly when STELLAR_NETWORK=mainnet — there is no safe default (see config.ts's TESTNET_DEFAULTS doc comment for why).`,
  );
}

export const config = {
  network,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  sorobanRpcUrl: networkValue("SOROBAN_RPC_URL", TESTNET_DEFAULTS.sorobanRpcUrl),
  networkPassphrase: networkValue("NETWORK_PASSPHRASE", TESTNET_DEFAULTS.networkPassphrase),
  // Never defaulted, on either network — this is EatOvr's own
  // AttestationRegistry deployment, which has no sensible fallback:
  // a mainnet deploy would be a different id than the testnet one,
  // not a value any lookup table could know in advance.
  contractId: required("CONTRACT_ID"),
  indexerPollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000),
  // A Stellar keypair is cryptographically network-agnostic, but
  // using the SAME funded key as both your testnet and mainnet
  // platform/sponsor account is a bad security practice regardless —
  // a testnet key is throwaway by nature; a mainnet one controls
  // real funds. Keep them separate even though nothing here enforces it.
  sponsorSecret: required("SPONSOR_SECRET"),

  // Sponsor Food. Left optional (not `required()`) so the rest of the
  // service still starts without them — Trustless Work's API key in
  // particular has to be requested by a human at backoffice.trustlesswork.com
  // (see docs/BUILDATHON-PLAN.md), so it may simply not exist yet.
  // Routes that need it check `config.trustlessWorkApiKey` themselves
  // and fail clearly, rather than crashing the whole process at boot.
  //
  // IMPORTANT: a BackOffice-issued API key only authenticates against
  // the ONE host it was issued for (confirmed live — see the
  // sponsor-food-build skill) — testnet's key will not work against
  // the mainnet host or vice versa. Switching `STELLAR_NETWORK` to
  // mainnet does NOT get you a working key for free; request a
  // separate one from BackOffice for mainnet specifically.
  trustlessWorkApiKey: process.env.TRUSTLESS_WORK_API_KEY ?? "",
  trustlessWorkBaseUrl: networkValue("TRUSTLESS_WORK_BASE_URL", TESTNET_DEFAULTS.trustlessWorkBaseUrl),
  // Pays/signs escrow release calls and is where released USDC lands —
  // not a donor key, not a vendor key. Paying it onward to the
  // specific fulfilling vendor's own address is a real, separate
  // follow-on transfer, not wired this week (see
  // sponsorship/trustless-work.ts and schema.prisma's SponsorshipBatch).
  // Same network-agnostic-but-keep-separate note as sponsorSecret above.
  platformSecret: process.env.PLATFORM_SECRET ?? "",
  reflectorCexDexContractId: networkValue(
    "REFLECTOR_CEX_DEX_CONTRACT_ID",
    TESTNET_DEFAULTS.reflectorCexDexContractId,
  ),
  // Trustless Work's v1 escrow `trustline.address` field wants the
  // asset's **issuer address** (`G...`), not its Stellar Asset
  // Contract id (`C...`) — a real, documented gotcha, not guessed.
  usdcContractId: networkValue("USDC_CONTRACT_ID", TESTNET_DEFAULTS.usdcContractId),
  usdcIssuer: networkValue("USDC_ISSUER", TESTNET_DEFAULTS.usdcIssuer),

  // Tells the real Eatovr backend once a sponsored unit's escrow
  // releases, so it can pay the fulfilling vendor (see
  // sponsorship/service.ts's `notifyBackendOfRelease` and
  // docs/BUILDATHON-PLAN.md's "sponsored meal credit" design). Both
  // optional — the indexer just keeps retrying `backendNotifiedAt`-less
  // units every poll until these are set, rather than crashing boot.
  // Neither is Stellar-network-dependent — eatovr's backend never
  // talks to Stellar directly at all (see its own doc note on this).
  eatovrBackendUrl: process.env.EATOVR_BACKEND_URL ?? "",
  sponsorshipWebhookSecret: process.env.SPONSORSHIP_WEBHOOK_SECRET ?? "",
};
