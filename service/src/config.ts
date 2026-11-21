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
};
