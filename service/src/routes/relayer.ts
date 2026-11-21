import type { FastifyInstance } from "fastify";
import { relaySignedXdr, relayFuncAndAuth } from "../soroban/relayer.js";

/**
 * Implements the plain HTTP "relayer" contract smart-account-kit (and
 * similar passkey/smart-wallet SDKs) expect — see
 * docs/PASSKEY_ATTESTATION_INTEGRATION_PLAN.md in the Eatovr repo for
 * why this lives here instead of a third-party relay service.
 */
export async function relayerRoutes(app: FastifyInstance) {
  app.get("/", async () => ({ ok: true }));

  app.get("/status", async (request) => ({
    ip: request.ip,
    network: "testnet",
  }));

  app.post<{ Body: { xdr?: string; func?: string; auth?: string[] } }>(
    "/",
    async (request, reply) => {
      const { xdr, func, auth } = request.body ?? {};

      // Response shape here must match smart-account-kit's own
      // `RelayerResponse` exactly — verified against its real published
      // types, not guessed: { success, hash?, status?, error?,
      // errorCode? }, HTTP 200 even on a relay-level failure (the kit
      // never throws for an expected on-chain/relayer failure, it
      // branches on `success` in the body).
      try {
        if (xdr) {
          const result = await relaySignedXdr(xdr);
          return { success: true, hash: result.hash, status: result.status };
        }
        if (func && auth) {
          const result = await relayFuncAndAuth(func, auth);
          return { success: true, hash: result.hash, status: result.status };
        }
        return reply
          .status(400)
          .send({ success: false, error: "Provide either { xdr } or { func, auth }" });
      } catch (err) {
        request.log.error(err);
        return {
          success: false,
          error: err instanceof Error ? err.message : "Relay failed",
        };
      }
    },
  );
}
