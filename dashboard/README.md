# Eatovr Proof — public dashboard

Public Next.js site showing aggregate "verified meals rescued"
numbers, each linking to its actual on-chain transaction, read from
the [Attestation Service](../service)'s read model — not from
Eatovr's own reporting.

## Status

Built (this package started from a trimmed-down personal Next.js/
shadcn boilerplate, not from Eatovr's codebase — see the root
[`CLAUDE.md`](../.claude/CLAUDE.md) ground rules). `app/page.tsx` is a
server component that reads the Attestation Service's `/pickups` and
`/sponsorships` endpoints (revalidated every 15s) and renders:

- Impact overview: verified meals rescued, confirmed/awaiting pickups,
  total USDC sponsored, and sponsored-meal units redeemed/available.
- A Sponsorships table — each Sponsor Food batch, its donor, region,
  unit counts, and status.
- A table of every finalized attestation, each with links straight to
  its `claim_pickup`/`confirm_pickup` transaction on Stellar Expert,
  a "Sponsored" badge on orders funded through Sponsor Food, and a
  filter by region and by commercial-vs-donation-recovery (a GET form,
  server-rendered via `searchParams` — no client JS needed). Neither
  field exists on-chain; see `service/README.md`'s API table for
  `/pickups/:orderId/metadata`.
- Two time-series charts (meals rescued per day, sponsorships per
  day, last 14 days) — `components/shared/time-series-chart.tsx`,
  built per the `dataviz` skill's procedure: single-series bar charts
  (small multiples, never one dual-axis chart), reusing the app's own
  `--primary`/`--chart-4` tokens rather than a new palette, per-bar
  hover tooltip, no legend.
- An error state if the service is unreachable, rather than a blank
  or broken page.
- `app/sponsor/page.tsx` — the Sponsor Food donor page: a tier picker,
  optional region, wallet connect via Stellar Wallets Kit
  (`@creit.tech/stellar-wallets-kit`, real v2.8.0 API — a static-class
  singleton, not an instantiated object), and the signing flow for
  each sponsored unit's escrow deploy + fund transactions. Also has a
  "claim a sponsored meal" demo button standing in for the real
  customer-app surface.

`pnpm build` and `tsc --noEmit` both pass, and the rendered HTML has
been checked against the actual running Attestation Service (including
with live Sponsor Food data). Not yet checked in an actual browser —
do that before relying on it for a live demo.

## Setup

```sh
cp .env.example .env.local   # SERVICE_URL + NEXT_PUBLIC_SERVICE_URL, default to :3900
pnpm install
pnpm dev                      # http://localhost:3000
```

Needs the [Attestation Service](../service) running and reachable at
`SERVICE_URL` (server-side fetches) and `NEXT_PUBLIC_SERVICE_URL`
(the Sponsor Food page's client-side wallet flow calls it directly).
