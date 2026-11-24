"use client";

import { useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { connectWallet, signXdr } from "@/lib/wallet";
import type { SponsorshipTier } from "@/lib/sponsorships";
import { cn } from "cn";

const SERVICE_URL = process.env.NEXT_PUBLIC_SERVICE_URL ?? "http://localhost:3900";

type UnitInProgress = { unitId: string; index: number; deployXdr: string };

/**
 * One escrow per sponsored unit (see schema.prisma's SponsorshipBatch
 * doc comment for why) means the donor signs *two* transactions per
 * unit — deploy, then fund — both via Stellar Wallets Kit. For a
 * 10-meal tier that's up to 20 signature prompts; acceptable for a
 * hackathon demo and disclosed in the UI below, not hidden.
 */
export function SponsorForm({ tiers }: { tiers: SponsorshipTier[] }) {
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "1");
  const [region, setRegion] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleConnect() {
    setError(null);
    try {
      const addr = await connectWallet();
      setAddress(addr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection failed");
    }
  }

  async function handleSponsor() {
    if (!address) return;
    setBusy(true);
    setError(null);
    setDone(false);

    try {
      setStatus("Deploying each unit's escrow...");
      const createResponse = await fetch(`${SERVICE_URL}/sponsorships`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          donorPublicKey: address,
          tierId,
          region: region.trim() || undefined,
        }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) throw new Error(created.error ?? "Could not start sponsorship");

      const units: UnitInProgress[] = created.units;

      for (const unit of units) {
        setStatus(`Signing escrow deploy for meal ${unit.index + 1} of ${units.length}...`);
        const signedDeploy = await signXdr(unit.deployXdr, address);

        const deployResponse = await fetch(
          `${SERVICE_URL}/sponsorships/units/${unit.unitId}/submit-deploy`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signedXdr: signedDeploy }),
          },
        );
        const deployResult = await deployResponse.json();
        if (!deployResponse.ok) throw new Error(deployResult.error ?? "Deploy submit failed");

        setStatus(`Signing escrow funding for meal ${unit.index + 1} of ${units.length}...`);
        const signedFund = await signXdr(deployResult.fundXdr, address);

        const fundResponse = await fetch(
          `${SERVICE_URL}/sponsorships/units/${unit.unitId}/submit-fund`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ signedXdr: signedFund }),
          },
        );
        const fundResult = await fundResponse.json();
        if (!fundResponse.ok) throw new Error(fundResult.error ?? "Fund submit failed");
      }

      setStatus(null);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sponsorship failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sponsor Food</CardTitle>
        <CardDescription>
          Fund real, on-chain-tracked meals for Eatovr customers. Each unit gets its own
          Trustless Work escrow, released automatically once the recipient and vendor
          independently confirm the pickup — the same two-party proof this whole dashboard is
          built on.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Tier</label>
          <div className="flex flex-wrap gap-2">
            {tiers.map((tier) => (
              <button
                key={tier.id}
                type="button"
                onClick={() => setTierId(tier.id)}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  tierId === tier.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted",
                )}
              >
                {tier.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="region">
            Region (optional)
          </label>
          <input
            id="region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="Leave blank to fund anywhere Eatovr operates"
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        {!address ? (
          <Button onClick={handleConnect} className="w-fit">
            <Wallet /> Connect wallet
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Connected: <span className="font-mono">{address}</span>
            </p>
            <Button onClick={handleSponsor} disabled={busy} className="w-fit">
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Sponsoring..." : "Sponsor now"}
            </Button>
          </div>
        )}

        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {done ? (
          <p className="text-sm text-success">
            Sponsorship funded on testnet — it now shows up in the Sponsorships table below.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Testnet USDC, demo redemption rules. Each sponsored meal is deployed as its own
          Trustless Work escrow; a 10-meal tier means up to 20 wallet signature prompts
          (deploy + fund per unit) — a real limitation of funding many discrete units
          up front, not hidden here.
        </p>
      </CardContent>
    </Card>
  );
}
