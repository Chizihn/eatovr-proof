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
crypto-native users, and that's the realistic path to adoption.
Eatovr's own core marketplace stays non-fintech — Paystack is the only
way an ordinary customer pays, no exceptions.

## Sponsor Food — a second, additive Stellar primitive

On top of the verification layer, outside web donors can fund real,
on-chain-tracked meals through **Sponsor Food** — new money entering
from donors who are already choosing to engage with a wallet, not a
change to how Eatovr's own customers pay. A donor picks a meal-count
tier; each sponsored meal gets its own
[Trustless Work](https://docs.trustlesswork.com/trustless-work) escrow,
funded by the donor's connected wallet via
[Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
and released automatically the moment that meal's pickup independently
finalizes on-chain — the same two-party attestation above triggers the
payout. Pricing is checked against a live
[Reflector](https://reflector.network) oracle read, not a hardcoded
number. **Proven end-to-end on testnet** — see
[`service/README.md`](service/README.md#sponsor-food) for the real
escrow and transaction links. Full design in
[`docs/BUILDATHON-PLAN.md`](docs/BUILDATHON-PLAN.md).

`AttestationRegistry` is also registered in the
[Stellar Registry](https://github.com/theahaco/scaffold-stellar) under
`unverified/eatovr-attestation-registry` for discoverability —
[registration tx](https://stellar.expert/explorer/testnet/tx/ba99a5b87f837e4abedd7fad1dcc74ce7379c47e18c42d980ca9fa5b921254ac).

## What's in this repo

| Path | What | Status |
|---|---|---|
| `contracts/attestation-registry/` | The `AttestationRegistry` Soroban contract, order-id-keyed (deferred-confirm) | **Built, tested, deployed to testnet** — see below |
| `service/` | Standalone Attestation Service — relays app confirm actions into contract calls, indexes finalized events into Postgres, and (Sponsor Food) deploys/releases per-meal Trustless Work escrows | **Built, proven end-to-end on testnet** — see below |
| `dashboard/` | Public Next.js site showing aggregate verified numbers and sponsorships, each linking to its on-chain transaction | **Built** — impact overview, sponsorships table, attestations table, Sponsor Food donor page |
| `demo-client/` | Mock client that calls the service exactly the way the real Eatovr app will, so anyone can run and verify the whole loop independently — including Sponsor Food's full donor→escrow→pickup→release loop | **Built, proven end-to-end on testnet** — see below |

## Proof it works

The contract has been deployed to Stellar testnet and the full
two-party flow has been run live, with two independent seeded testnet
identities standing in for a vendor and a recipient:

- Contract:
  [`CDII3ONLMNCEYTVO77V2X5WAZRAPBIJRYFGCETQ42X62CDXJGDKGUH2R`](https://lab.stellar.org/r/testnet/contract/CDII3ONLMNCEYTVO77V2X5WAZRAPBIJRYFGCETQ42X62CDXJGDKGUH2R)
  (redeployed, order-id-keyed — see `src/lib.rs`'s `DataKey::Claim` doc
  comment for why)
- Vendor claims a pickup →
  [transaction](https://stellar.expert/explorer/testnet/tx/683842de10bb314bd0db811335813e652a19ece9e850b68da78ec44c91299367)
  (`claimed` event)
- A **different** keypair, the recipient, independently confirms it —
  signed at (simulated) checkout, before the claim above ever ran, and
  auto-submitted by the indexer the moment it landed →
  [transaction](https://stellar.expert/explorer/testnet/tx/c17ca388f3e99d2f57b6947c4972a2aa0c18372a56106a05819ffa68c89ec6dd)
  (`finalized` event)
- The record now reads `status: "Finalized"` on-chain, with both
  parties' addresses and both timestamps recorded.

Full detail, including the failure cases the contract rejects (wrong
recipient confirming, double-confirming, a vendor naming itself as the
recipient) and how to build/test/deploy it yourself, is in
[`contracts/README.md`](contracts/README.md).

That first proof called the contract directly through the Stellar CLI.
The Attestation Service and demo client have since reproduced the same
two-party flow through the actual API surface the real app will use —
the service builds an unsigned transaction, the caller signs it locally
(never sharing a private key with the service), and the service's own
indexer picks up the result into its Postgres read model within
seconds. See [`service/README.md`](service/README.md) for that run's
transaction links.

**Honesty note:** no real vendor is onboarded to this yet, and Eatovr's
main backend API isn't live. The above is seeded demo accounts on
testnet, not a running pilot with real numbers. This is the
verification layer proven end-to-end, ready to activate for the first
live vendor. Sponsor Food carries the same standard: testnet USDC, demo
"claim a sponsored meal" redemption rules (the real product gates this
through verified NGOs/beneficiaries, not an open claim button), and
escrow release moves USDC to Eatovr's own platform settlement
address — paying it onward to the specific vendor, and eventually
converting to naira via a real SEP-24 anchor, is a real production
step not built this week.

## Why this repo is separate from Eatovr's main app

Eatovr's main app and backend repo is private, and stays that way — a
real, pre-revenue business reaching out to vendors right now, not
hackathon throwaway code. This repo contains only the new,
purpose-built verification layer, which is genuinely meant to be open
and auditable by anyone — that's the entire point of it. The one change
this project eventually needs inside Eatovr's own private app (making
pickup confirmation two-sided, and adding passkey signing for that
step) happens in that repo, not here.
