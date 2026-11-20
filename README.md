# Eatovr Proof

[Eatovr](https://eatovr.com/) is a live food-surplus-recovery
marketplace in Nigeria, published on both the
[Google Play Store](https://play.google.com/store/apps/details?id=com.eatovr.app)
and the
[Apple App Store](https://apps.apple.com/us/app/eatovr-food-recovery/id6810906863),
that lets food vendors sell surplus food cheaply instead of throwing it
away, and lets individuals and NGOs pick it up. Like every
platform in this space, Eatovr reports an impact number — "X meals
rescued" — but that number is entirely self-reported. An NGO, a
corporate CSR donor, or a government partner has no way to
independently verify that a claimed pickup actually happened.

**This repo is the missing trust layer.** It adds a Soroban smart
contract that only finalizes a pickup's "impact record" once **both**
the vendor (the surplus-giver) and the recipient (an individual or NGO)
independently confirm it on-chain. Neither side can produce a verified
record alone.

This repo is intentionally separate from, and does not contain any code
from, Eatovr's main application (private — it's a real product, not
hackathon code). This repo is the new, standalone, public verification
layer: the smart contract, the service that relays app actions into it,
and a public dashboard anyone can use to check the real numbers against
the chain directly — not against Eatovr's own reporting.

## How it works

```
Eatovr mobile app (existing, live)
  vendor confirms pickup  ──┐         ┌── recipient/NGO confirms pickup
  (passkey smart wallet)    │         │   (passkey smart wallet)
                             v         v
                    AttestationRegistry (Soroban contract)
                    finalizes + emits an event only once
                    BOTH parties' on-chain auth checks pass
                             │
                             v
                    Attestation Service (indexer/relay)
                    listens for finalized events,
                    writes a read model to Postgres
                             │
                             v
                    Public Impact Dashboard
                    "verified meals rescued", each number
                    links to the actual on-chain transaction
```

Vendors and NGO staff confirm with a passkey-based smart wallet
embedded in the app itself — biometric prompt, no seed phrase, no
separate wallet app. Small food stalls and NGO logistics staff are not
crypto-native users, and that's the realistic path to adoption. This is
a verification/attestation primitive only — it doesn't touch payments
or stablecoins, by design.

## What's in this repo

| Path | What | Status |
|---|---|---|
| `contracts/attestation-registry/` | The `AttestationRegistry` Soroban contract | **Built, tested, deployed to testnet** — see below |
| `service/` | Standalone Attestation Service — relays app confirm actions into contract calls, indexes finalized events into Postgres | Not started |
| `dashboard/` | Public Next.js site showing aggregate verified numbers, each linking to its on-chain transaction | Not started |
| `demo-client/` | Mock client that calls the service exactly the way the real Eatovr app will, so anyone can run and verify the whole loop independently | Not started |

## Proof it works

The contract has been deployed to Stellar testnet and the full
two-party flow has been run live, with two independent seeded testnet
identities standing in for a vendor and a recipient:

- Contract:
  [`CDTKXIYY745COZNVOJIPBTVDBYJMDE3V253IMXVILWOI3NDTK7FK2ITS`](https://lab.stellar.org/r/testnet/contract/CDTKXIYY745COZNVOJIPBTVDBYJMDE3V253IMXVILWOI3NDTK7FK2ITS)
- Vendor claims a pickup →
  [transaction](https://stellar.expert/explorer/testnet/tx/62046d999bb97c4a40cc9604aeaf3818bff11669a4524ef2e219f230e235a739)
  (`claimed` event)
- A **different** keypair, the recipient, independently confirms it →
  [transaction](https://stellar.expert/explorer/testnet/tx/63aafb3c5c1fb4e645944408f5bbbbea82345235b47d444d10fa50510d2c549d)
  (`finalized` event)
- The record now reads `status: "Finalized"` on-chain, with both
  parties' addresses and both timestamps recorded.

Full detail, including the failure cases the contract rejects (wrong
recipient confirming, double-confirming, a vendor naming itself as the
recipient) and how to build/test/deploy it yourself, is in
[`contracts/README.md`](contracts/README.md).

**Honesty note:** no real vendor is onboarded to this yet, and Eatovr's
main backend API isn't live. The above is seeded demo accounts on
testnet, not a running pilot with real numbers. This is the
verification layer proven end-to-end, ready to activate for the first
live vendor.

## Why this repo is separate from Eatovr's main app

Eatovr's main app and backend repo is private, and stays that way — a
real, pre-revenue business reaching out to vendors right now, not
hackathon throwaway code. This repo contains only the new,
purpose-built verification layer, which is genuinely meant to be open
and auditable by anyone — that's the entire point of it. The one change
this project eventually needs inside Eatovr's own private app (making
pickup confirmation two-sided, and adding passkey signing for that
step) happens in that repo, not here.
