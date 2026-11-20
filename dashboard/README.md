# Eatovr Proof — public dashboard

Public Next.js site showing aggregate "verified meals rescued"
numbers, each linking to its actual on-chain transaction, read from
the [Attestation Service](../service)'s read model — not from
Eatovr's own reporting.

## Status

Built (this package started from a trimmed-down personal Next.js/
shadcn boilerplate, not from Eatovr's codebase — see the root
[`CLAUDE.md`](../.claude/CLAUDE.md) ground rules). `app/page.tsx` is a
server component that reads the Attestation Service's `/pickups`
endpoint (revalidated every 15s) and renders:

- Aggregate stats: total verified meals rescued, confirmed pickups,
  and how many are still awaiting the recipient's independent
  confirmation.
- A table of every finalized record, each with links straight to its
  `claim_pickup`/`confirm_pickup` transaction on Stellar Expert.
- An error state if the service is unreachable, rather than a blank
  or broken page.

Verified against a mocked `/pickups` response matching the real
service's shape; not yet checked against the actual running service
from a real browser.

## Setup

```sh
cp .env.example .env.local   # SERVICE_URL, defaults to the local service on :3900
pnpm install
pnpm dev                      # http://localhost:3000
```

Needs the [Attestation Service](../service) running and reachable at
`SERVICE_URL`.
