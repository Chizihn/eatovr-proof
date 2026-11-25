# Attestation Service

Relays the two-party pickup confirmation into the `AttestationRegistry`
Soroban contract (see [`../contracts`](../contracts)), and indexes the
contract's `claimed`/`finalized` events into a Postgres read model that
the public dashboard reads from.

It never holds a vendor's or recipient's private key. The flow for
each party's action is:

1. `POST /pickups/:orderId/claim/prepare` (or
   `/pickups/:orderId/confirm/prepare`) — the service builds an
   unsigned transaction and returns its XDR. `orderId` is Eatovr's own
   order id, not an on-chain-minted id (see
   [`../contracts/README.md`](../contracts/README.md)).
2. The caller (the real app's passkey wallet, eventually — a demo
   script standing in for it today, see
   [`../demo-client`](../demo-client)) signs that XDR **locally** with
   the vendor's or recipient's own key.
3. `POST /transactions/submit` with the signed XDR — the service
   submits it and waits for it to land, returning the chain's result.

Separately, a background loop polls Soroban RPC's `getEvents` for this
contract and writes `claimed`/`finalized` events into the `attestations`
table — this is the only thing that writes the read model; the relay
routes never write to it directly.

### Deferred confirm

`POST /pickups/:orderId/pre-confirm` lets the recipient sign
`confirm_pickup` once, at checkout — before the vendor has claimed
anything — and stores the signed authorization unsubmitted
(`PendingConfirmation` in `schema.prisma`). The indexer's own poll loop
(`src/indexer/run.ts`'s `submitPendingConfirmationIfAny`) submits it
automatically the moment the matching `claimed` event lands, via the
relayer below. No second action from the recipient, ever. **Proven on
testnet** via [`../demo-client/src/deferred-confirm.ts`](../demo-client/src/deferred-confirm.ts).

### Relayer (for passkey/smart-wallet callers)

A separate set of routes (`GET /`, `POST /`, `GET /status`) implements
the plain HTTP "relayer" contract `smart-account-kit` and similar
passkey/smart-wallet SDKs expect — see
`docs/PASSKEY_ATTESTATION_INTEGRATION_PLAN.md` in the Eatovr repo. A
dedicated `SPONSOR_SECRET` account pays network fees on behalf of
passkey-controlled wallets, which don't hold XLM themselves — it has
no authority over any attestation, only ever pays fees. The response
shape (`{ success, hash?, status?, error?, errorCode? }`, always HTTP
200) was checked directly against `smart-account-kit`'s own published
`RelayerResponse` type — not guessed — since the kit branches on
`success` in the body rather than the HTTP status. Two input shapes,
both proxying to the same submit-and-wait logic the `/pickups` routes
use:

- `{ xdr }` — an already-signed transaction; wrapped in a fee-bump
  envelope (doesn't disturb the inner transaction's own
  signatures/auth) and submitted. **Proven on real testnet**, twice —
  once before and once after the response-shape fix above — with a
  transaction signed by an unrelated throwaway account.
- `{ func, auth }` — a host function + pre-signed Soroban authorization
  entries, no funded account required from the caller; the sponsor
  account builds and pays for the transaction around them. **Proven on
  real testnet** both via the deferred-confirm flow above (the indexer
  calls this exact path, `relayFuncAndAuth`, to auto-submit a
  recipient's pre-signed confirmation) and on a real iOS device with
  the actual mobile app's passkey wallet.

## Status

Proven end-to-end on testnet: a vendor identity claimed a pickup, a
**different** recipient identity independently confirmed it (both
signing locally, neither secret ever touching this service), and the
indexer picked up both events into the read model within seconds —

```json
{
  "orderId": "demo-order-43bde772-3e70-4810-b0a3-9bf9b1785e37",
  "vendor": "GAG4O3QF2422KABPOMYSASWNOFJ6USMEAKL4LRHAZMAX7WTTFAX7EV2M",
  "recipient": "GAPMVJCGWW7J5ZCWYKRKGQ5KMTMYBNNGWZJDZP26RBOO4MEMS5X6R5NQ",
  "itemType": "rice_and_stew_trays",
  "quantity": 8,
  "status": "Finalized",
  "claimedAt": "2026-11-23T15:44:47.000Z",
  "confirmedAt": "2026-11-23T15:44:52.000Z",
  "claimTxHash": "683842de10bb314bd0db811335813e652a19ece9e850b68da78ec44c91299367",
  "confirmTxHash": "c17ca388f3e99d2f57b6947c4972a2aa0c18372a56106a05819ffa68c89ec6dd"
}
```

The deferred-confirm path above has also been run live end to end —
see [`../demo-client/src/deferred-confirm.ts`](../demo-client/src/deferred-confirm.ts).

These are seeded demo accounts, not a real vendor/recipient pair — see
the honesty note in the root [`README.md`](../README.md).

## Sponsor Food

A second feature, additive to the attestation flow above: outside web
donors fund real, on-chain-tracked meals via
[Trustless Work](https://docs.trustlesswork.com/trustless-work) escrow
(`src/sponsorship/trustless-work.ts`, their real **v1** REST API —
`dev.api.trustlesswork.com`; their v2 beta API exists but a
BackOffice-issued testnet key doesn't authenticate against it, see
[`sponsor-food-build`](../.claude/skills/sponsor-food-build) for how
that was confirmed), priced against a live
[Reflector](https://reflector.network) oracle read
(`src/reflector/client.ts`, **proven live against testnet**:
`@reflector/contract-client`'s `PulseClient.lastPrice('USDC')`).

Each sponsored meal ("unit") gets its **own** escrow, not one escrow
per batch — Trustless Work's single-release escrow pays only its one
fixed receiver once its milestone is completed and approved, and
there's no refund/cancel-on-expiry endpoint, so one-per-batch couldn't
fund meals redeemed across different vendors. See
`prisma/schema.prisma`'s `SponsorshipBatch` doc comment for the full
reasoning. The receiver/approver/serviceProvider/releaseSigner on
every unit's escrow is Eatovr's own platform settlement address
(`PLATFORM_SECRET`), not the donor and not the eventual vendor — the
vendor isn't known until a customer claims the unit. Because the
platform holds every administrative role, the indexer completes +
approves + releases a unit's escrow unilaterally, automatically, when
its order's `finalized` event lands (`src/indexer/run.ts`'s
`releaseUnitIfSponsored`) — no second signer needed.

Requires `TRUSTLESS_WORK_API_KEY` (request one at
backoffice.trustlesswork.com — log in with a Stellar wallet, fill in a
"Use Case", choose testnet) and a funded, USDC-trustlined
`PLATFORM_SECRET` keypair; see `.env.example`. Without a key, every
other route in this service still starts and works fine — only the
Sponsor Food routes fail, with a clear error naming what's missing.

**Proven end-to-end on testnet**, fully automatic after the donor's
two signatures (deploy + fund):
- Escrow deployed: `CAECWKDEEEPJUU3ROWZ4XLVGWVT2NHCJU7V465LFHBX4KIZIXPVLOBHC`
- Donor funds the escrow →
  [tx](https://stellar.expert/explorer/testnet/tx/38ad7df91b3602c008e680918b5b01522dd9c865279df7d11d998ed9ea61afe7)
- A customer claims the sponsored meal, the normal unmodified
  `claim_pickup`/`confirm_pickup` flow finalizes it, and the indexer
  releases the escrow automatically →
  [tx](https://stellar.expert/explorer/testnet/tx/f807755b77fd187cb8362bbc3f191cd9478e2c92b6eedcf77dfce2f20176114a)

Reproducible via
[`../demo-client/src/sponsor-food.ts`](../demo-client/src/sponsor-food.ts).
Trustless Work's own `/helper/send-transaction` response doesn't
reliably include a Stellar tx hash — the hashes above were computed
directly from the signed transaction (`Transaction.hash()`), not taken
from their response; see the skill above for why.

### A known RPC flakiness, in case it resurfaces

The public `soroban-testnet.stellar.org` endpoint (Cloudflare-fronted)
is intermittently flaky in two different ways: a connect timeout
(Node's `fetch` sometimes picks an IPv6 route that doesn't actually
connect, while `curl`/the Stellar CLI fall back to IPv4 reliably), and
occasionally a clean-but-wrong empty response (e.g. "account not
found" for an account that demonstrably exists, likely backend replica
lag). `src/server.ts` forces IPv4 DNS resolution
(`dns.setDefaultResultOrder("ipv4first")`), and `src/soroban/retry.ts`
wraps the read calls (`getAccount`, `prepareTransaction`,
`getLatestLedger`, `getEvents`) with a retry-with-backoff, which
absorbs both failure modes without masking a genuinely bad request.

## Setup

```sh
cp .env.example .env   # then fill in DATABASE_URL etc.
docker compose up -d   # dedicated Postgres on 127.0.0.1:5434
pnpm install            # or npm install
npx prisma generate
npx prisma migrate dev --name init
```

## Run

```sh
pnpm run dev    # tsx watch, for local development
# or
pnpm run build && pnpm run start
```

`GET /health` confirms it's up. See
[`../demo-client`](../demo-client) for exercising the actual relay
flow end to end.

## API

| Route | Method | Body | What |
|---|---|---|---|
| `/pickups/:orderId/claim/prepare` | POST | `vendorPublicKey, recipientPublicKey, itemType, quantity` | Unsigned `claim_pickup` tx, source = vendor |
| `/pickups/:orderId/confirm/prepare` | POST | `recipientPublicKey` | Unsigned `confirm_pickup` tx, source = recipient |
| `/pickups/:orderId/pre-confirm` | POST | `recipientPublicKey, func, auth` | Stores a recipient's signed confirm, submitted automatically once claimed |
| `/pickups/:orderId/metadata` | POST | `region?, category?` | Attaches dashboard-filter metadata before claim — not part of any on-chain auth check |
| `/transactions/submit` | POST | `xdr` (signed) | Submits and waits; returns `{ status, hash, returnValue }` |
| `/pickups` | GET | query: `region?, category?` | Read model, newest first, optionally filtered |
| `/pickups/:orderId` | GET | — | One record from the read model |
| `/pickups/by-tx/:txHash` | GET | — | Resolves a record from either tx hash |
| `/` | POST | `{ xdr }` or `{ func, auth }` | Relayer: fee-sponsored submit for passkey wallets |
| `/` | GET | — | Relayer health check |
| `/status` | GET | — | Relayer status (caller IP, network) |
| `/sponsorships/tiers` | GET | — | Sponsor Food meal-count tiers |
| `/sponsorships` | GET | — | All sponsorship batches + their units |
| `/sponsorships` | POST | `donorPublicKey, tierId, region?` | Creates a batch, deploys each unit's escrow; returns unsigned deploy XDRs |
| `/sponsorships/units/:unitId/submit-deploy` | POST | `signedXdr` | Submits escrow deploy; returns the unsigned fund XDR |
| `/sponsorships/units/:unitId/submit-fund` | POST | `signedXdr` | Submits escrow funding; unit becomes `Available` |
| `/sponsorships/claim` | POST | `region?` | Demo "claim a sponsored meal" — first-come-first-served |

## Stack

Fastify, Prisma 7 (with the `@prisma/adapter-pg` driver adapter — see
the Prisma 7 config notes in this repo's
[`attestation-service-build`](../.claude/skills/attestation-service-build)
skill if touching `prisma.config.ts`/`schema.prisma`), Postgres,
`@stellar/stellar-sdk`, `@fastify/cors` (`origin: true` — nothing here
is cookie/session-authenticated, so any origin is fine; needed because
the dashboard's `/sponsor` page calls this service directly from the
browser, and they're on different domains once both are deployed —
see `../docs/DEPLOYMENT.md`).

## Deploying publicly

See [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) — including
Vercel: indexing is request-driven (`triggerIndexOnce` in
`src/indexer/run.ts`, called synchronously right after every
transaction submission), not timer-driven, specifically so it doesn't
depend on a platform keeping one process running continuously.
`startIndexer`'s interval loop still runs too, as a belt-and-suspenders
safety net on a host where it *can* stay up (Railway, Render, local
dev) — just no longer required for correctness.
