import { setDefaultResultOrder } from "node:dns";
import Fastify from "fastify";
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
