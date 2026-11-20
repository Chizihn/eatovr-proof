# `AttestationRegistry`

The on-chain verification layer for [Eatovr](../README.md), a live
food-surplus-recovery marketplace in Nigeria. A pickup record finalizes
only once **both** parties have independently authorized a call
against it:

1. `claim_pickup(vendor, recipient, item_type, quantity)` — the vendor
   claims a pickup happened. Requires `vendor`'s own authorization.
   Returns a `claim_id`. Status: `Pending`.
2. `confirm_pickup(claim_id, recipient)` — the recipient named on that
   specific claim independently confirms it. Requires `recipient`'s own
   authorization, and the caller must be the exact address stored on the
   claim. Status moves to `Finalized`, and the contract emits a
   `finalized` event.

Neither call alone can produce a `Finalized` record — that enforcement
lives in the contract's own auth checks, not in a backend flag.

## Status

Proven end-to-end on testnet with seeded accounts, through the real
contract calls the app will eventually make — ready to activate for
the first live vendor, not yet wired into the Eatovr app itself.

- Unit tests: `cargo test -p attestation-registry` — 6/6 green
  (happy-path finalize plus every failure case).
- Deployed to testnet: contract id
  [`CDTKXIYY745COZNVOJIPBTVDBYJMDE3V253IMXVILWOI3NDTK7FK2ITS`](https://lab.stellar.org/r/testnet/contract/CDTKXIYY745COZNVOJIPBTVDBYJMDE3V253IMXVILWOI3NDTK7FK2ITS).
- Live two-party flow verified with two independent seeded testnet
  identities (`vendor` and `recipient`, two different keypairs):
  - `claim_pickup` by `vendor` →
    [tx](https://stellar.expert/explorer/testnet/tx/62046d999bb97c4a40cc9604aeaf3818bff11669a4524ef2e219f230e235a739)
    — `claimed` event, claim id `0`.
  - `confirm_pickup` by `recipient` (a different signing key than the
    vendor's) →
    [tx](https://stellar.expert/explorer/testnet/tx/63aafb3c5c1fb4e645944408f5bbbbea82345235b47d444d10fa50510d2c549d)
    — `finalized` event.
  - `get_claim` confirms `status: "Finalized"` with both parties'
    addresses and both timestamps recorded on-chain.

These are seeded demo accounts, not a real vendor/recipient pair — no
real pickup happened. This is the verification layer tested
end-to-end, ready to activate once a real vendor is onboarded.

Note: building this against `soroban-sdk = "22.0.0"` currently pulls in
`ed25519-dalek 3.0.0` transitively via `soroban-env-host`'s testutils,
which doesn't yet compile against the `rand_core`/`ChaCha20Rng` version
also in the graph. Fixed locally with:

```sh
cargo update -p ed25519-dalek@3.0.0 --precise 2.2.0
```

That pin lives in `Cargo.lock` (commit it) — re-run the above if a
future `cargo update` regenerates the conflict before upstream catches
up.

Separately: Rust 1.82+ enables wasm `reference-types`/`multi-value`
codegen by default for the `wasm32-unknown-unknown` target, which
Soroban's host VM rejects at deploy time with
`HostError: Error(WasmVm, InvalidAction)`. `soroban-sdk`'s own build
script (as of v30) detects this and points at the fix: build for the
`wasm32v1-none` target instead (available since Rust 1.84), not
`wasm32-unknown-unknown`. See
[stellar/rs-soroban-sdk#1438](https://github.com/stellar/rs-soroban-sdk/issues/1438)
for the history — pinning Rust itself back to 1.81 is a dead end on a
modern toolchain, since enough of the rest of the crates.io ecosystem
now requires `edition2024` (stabilized Rust 1.85) that transitive
dependencies become unbuildable on 1.81 one by one.

## Build / test (run on a machine with the Rust + Soroban toolchain)

```sh
cargo test -p attestation-registry
rustup target add wasm32v1-none
cargo build -p attestation-registry --target wasm32v1-none --release
```

## Deploy to testnet (once it builds and tests pass)

```sh
stellar contract deploy \
  --wasm target/wasm32v1-none/release/attestation_registry.wasm \
  --source <your-testnet-identity> \
  --network testnet
```

Per the project's ground rules (see `../CLAUDE.md`), any deployment here
is to **testnet with seeded demo accounts**, not a live pilot with real
vendors — state that plainly wherever this gets referenced.
