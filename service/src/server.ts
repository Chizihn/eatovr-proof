import { setDefaultResultOrder } from "node:dns";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";

// Node's fetch (undici) can intermittently try an IPv6 route to
// soroban-testnet.stellar.org that doesn't actually connect, producing
// either a connect timeout or an empty/wrong response, while curl and
// other clients fall back to IPv4 reliably. Force IPv4 first so this
// doesn't depend on every invocation remembering a NODE_OPTIONS flag.
setDefaultResultOrder("ipv4first");
import { pickupRoutes } from "./routes/pickups.js";
import { relayerRoutes } from "./routes/relayer.js";
import { sponsorshipRoutes } from "./routes/sponsorships.js";
import { startIndexer } from "./indexer/run.js";

const app = Fastify({ logger: true });

// Everything here is a public read model or requires a wallet
// signature to mutate anything — there's no cookie/session auth to
// protect, so allowing any origin is fine. Needed because the
// dashboard's /sponsor page calls this service directly from the
// browser (the wallet-signing flow), and dashboard + service live on
// different domains once both are deployed.
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

await app.register(pickupRoutes);
await app.register(relayerRoutes);
await app.register(sponsorshipRoutes);

startIndexer(config.indexerPollIntervalMs);

try {
  const address = await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`Attestation Service listening on ${address}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
