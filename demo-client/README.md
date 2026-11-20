# demo-client

Stands in for the real Eatovr app. It calls the Attestation Service
exactly the way the app's passkey wallet eventually will: it asks the
service to *prepare* an unsigned transaction, signs it **locally**, and
posts the signed result back for submission. The service never
receives a private key — the one thing this script does differently
from the eventual real app is sign with a raw secret key instead of a
passkey-gated hardware key.

Anyone (a judge, an NGO, you) can run this to independently verify the
whole two-party flow actually happens on-chain, without touching
Eatovr's private app or backend.

## Setup

Needs two already-funded testnet identities — a vendor and a recipient
(see `../contracts/README.md` for how to create them with
`stellar keys generate`/`stellar keys fund`).

**Never paste a secret key into chat, a commit, or anywhere other than
your own shell.** Export them directly from the Stellar CLI's own
storage:

```sh
export VENDOR_SECRET=$(stellar keys secret vendor)
export RECIPIENT_SECRET=$(stellar keys secret recipient)
```

The Attestation Service must be running (see `../service/README.md`)
and reachable at `SERVICE_URL` (defaults to `http://localhost:3900`).

## Run

```sh
cd demo-client
npm install   # or pnpm install
npm start
```

Expected output: the vendor claims a pickup, the recipient
independently confirms it with a completely different key, and the
script polls the service's read model until it shows `"Finalized"` —
proving the two-party on-chain flow end to end through the same API
surface the real app will use.
