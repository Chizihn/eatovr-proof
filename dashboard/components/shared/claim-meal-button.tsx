"use client";

import { useState } from "react";
import { Loader2, Soup } from "lucide-react";
import { Button } from "@/components/ui/button";

const SERVICE_URL = process.env.NEXT_PUBLIC_SERVICE_URL ?? "http://localhost:3900";

/**
 * The demo "claim a sponsored meal" surface — first-come-first-served,
 * any customer, explicitly a demo simplification (see
 * docs/BUILDATHON-PLAN.md: the real product gates this through
 * verified NGOs/beneficiaries, not an open claim button). Stands in
 * for a real customer-app surface the same way demo-client/ stands
 * in for the real mobile app elsewhere in this repo.
 */
export function ClaimMealButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClaim() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`${SERVICE_URL}/sponsorships/claim`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Claim failed");
      setResult(data.orderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={handleClaim} disabled={busy} variant="outline" className="w-fit">
        {busy ? <Loader2 className="animate-spin" /> : <Soup />}
        Claim a sponsored meal (demo)
      </Button>
      {result ? (
        <p className="text-xs text-muted-foreground">
          Claimed — order <span className="font-mono">{result}</span>. It now goes through the
          exact same claim_pickup/confirm_pickup flow as any order.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
