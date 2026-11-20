# Attestation Service

Relays the two-party pickup confirmation into the `AttestationRegistry`
Soroban contract (see [`../contracts`](../contracts)), and indexes the
contract's `claimed`/`finalized` events into a Postgres read model that
the public dashboard reads from.

It never holds a vendor's or recipient's private key. The flow for
each party's action is:

1. `POST /pickups/claim/prepare` (or `/pickups/:claimId/confirm/prepare`)
   — the service builds an unsigned transaction and returns its XDR.
2. The caller (the real app's passkey wallet, eventually — a demo
   script standing in for it today, see
   [`../demo-client`](../demo-client)) signs that XDR **locally** with
   the vendor's or recipient's own key.
3. `POST /transactions/submit` with the signed XDR — the service
   submits it and waits for it to land, returning the chain's result
   (including the `claim_id` the contract assigned, for `claim_pickup`).

Separately, a background loop polls Soroban RPC's `getEvents` for this
contract and writes `claimed`/`finalized` events into the `attestations`
table — this is the only thing that writes the read model; the relay
routes never write to it directly.

## Status

Proven end-to-end on testnet: a vendor identity claimed a pickup, a
**different** recipient identity independently confirmed it (both
signing locally, neither secret ever touching this service), and the
indexer picked up both events into the read model within seconds —

```json
{
  "claimId": "1",
  "vendor": "GAG4O3QF2422KABPOMYSASWNOFJ6USMEAKL4LRHAZMAX7WTTFAX7EV2M",
  "recipient": "GAPMVJCGWW7J5ZCWYKRKGQ5KMTMYBNNGWZJDZP26RBOO4MEMS5X6R5NQ",
  "itemType": "rice_and_stew_trays",
  "quantity": 8,
  "status": "Finalized",
  "claimedAt": "2026-11-20T12:32:20.000Z",
  "confirmedAt": "2026-11-20T12:32:25.000Z",
  "claimTxHash": "2530cb5bae87ed0f9cfecd174eb8b9546472be685f66a6859d11692eecbc1332",
  "confirmTxHash": "795ca3d7485d17f809b055a8f96c297497b65b40f309d9c0a829cc3866aa91b1"
}
```

These are seeded demo accounts, not a real vendor/recipient pair — see
the honesty note in the root [`README.md`](../README.md).

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
| `/pickups/claim/prepare` | POST | `vendorPublicKey, recipientPublicKey, itemType, quantity` | Unsigned `claim_pickup` tx, source = vendor |
| `/pickups/:claimId/confirm/prepare` | POST | `recipientPublicKey` | Unsigned `confirm_pickup` tx, source = recipient |
| `/transactions/submit` | POST | `xdr` (signed) | Submits and waits; returns `{ status, hash, returnValue }` |
| `/pickups` | GET | — | Read model, newest first |
| `/pickups/:claimId` | GET | — | One record from the read model |

## Stack

Fastify, Prisma 7 (with the `@prisma/adapter-pg` driver adapter — see
the Prisma 7 config notes in this repo's
[`attestation-service-build`](../.claude/skills/attestation-service-build)
skill if touching `prisma.config.ts`/`schema.prisma`), Postgres,
`@stellar/stellar-sdk`.
