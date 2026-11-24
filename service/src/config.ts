import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  sorobanRpcUrl: required("SOROBAN_RPC_URL"),
  networkPassphrase: required("NETWORK_PASSPHRASE"),
  contractId: required("CONTRACT_ID"),
  indexerPollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000),
  sponsorSecret: required("SPONSOR_SECRET"),

  // Sponsor Food. Left optional (not `required()`) so the rest of the
  // service still starts without them — Trustless Work's API key in
  // particular has to be requested by a human at backoffice.trustlesswork.com
  // (see docs/BUILDATHON-PLAN.md), so it may simply not exist yet.
  // Routes that need it check `config.trustlessWorkApiKey` themselves
  // and fail clearly, rather than crashing the whole process at boot.
  trustlessWorkApiKey: process.env.TRUSTLESS_WORK_API_KEY ?? "",
  // The BackOffice-issued testnet key only authenticates against this
  // v1 host — confirmed live: its `/helper/get-escrows-by-signer`
  // returned 200 with this key, while the v2 beta API
  // (beta.api.trustlesswork.com) 401'd it despite the route shapes
  // looking plausible. Don't "upgrade" this to the beta host without
  // re-verifying the key works there.
  trustlessWorkBaseUrl: process.env.TRUSTLESS_WORK_BASE_URL ?? "https://dev.api.trustlesswork.com",
  // Pays/signs escrow release calls and is where released USDC lands —
  // not a donor key, not a vendor key. Paying it onward to the
  // specific fulfilling vendor's own address is a real, separate
  // follow-on transfer, not wired this week (see
  // sponsorship/trustless-work.ts and schema.prisma's SponsorshipBatch).
  platformSecret: process.env.PLATFORM_SECRET ?? "",
  reflectorCexDexContractId:
    process.env.REFLECTOR_CEX_DEX_CONTRACT_ID ??
    "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63",
  // Testnet USDC's Stellar Asset Contract id — derived via
  // `stellar contract id asset --asset "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" --network testnet`,
  // not guessed. Used for the donor/platform's own trustline and
  // balance checks.
  usdcContractId:
    process.env.USDC_CONTRACT_ID ?? "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  // Trustless Work's v1 escrow `trustline.address` field wants the
  // asset's **issuer address** (`G...`), not its Stellar Asset
  // Contract id (`C...`) — a real, documented gotcha, not guessed.
  usdcIssuer: process.env.USDC_ISSUER ?? "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};
