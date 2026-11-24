import Link from "next/link";
import { ArrowLeft, Soup } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { SponsorForm } from "@/components/shared/sponsor-form";
import { ClaimMealButton } from "@/components/shared/claim-meal-button";
import { getSponsorshipTiers, type SponsorshipTier } from "@/lib/sponsorships";

export default async function SponsorPage() {
  let tiers: SponsorshipTier[] = [];
  let fetchError: string | null = null;

  try {
    tiers = await getSponsorshipTiers();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4 sm:px-10">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Soup className="size-5" />
            </div>
            <span className="font-heading text-lg font-semibold tracking-tight">
              Eatovr Proof
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8 sm:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to verified meals
        </Link>

        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Sponsor Food</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            New money from outside donors, funding real Eatovr meals through real Stellar
            financial protocols — additive to, not a replacement for, Eatovr&apos;s own Paystack
            checkout.
          </p>
        </div>

        {fetchError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t reach the Attestation Service</AlertTitle>
            <AlertDescription>{fetchError}</AlertDescription>
          </Alert>
        ) : (
          <SponsorForm tiers={tiers} />
        )}

        <div className="rounded-xl border p-6">
          <h2 className="font-heading text-base font-semibold">
            Already sponsored? Try the demo claim surface
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stands in for the real customer-app surface, the same way{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">demo-client/</code> stands in
            for the real mobile app elsewhere in this repo. First-come-first-served — the real
            product gates this through verified NGOs/beneficiaries.
          </p>
          <div className="mt-4">
            <ClaimMealButton />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Testnet</Badge>
          <p>
            Testnet USDC, demo redemption rules. Paying the fulfilling vendor onward from
            Eatovr&apos;s platform settlement address is a real follow-on transfer, not wired
            this week — same honesty standard as the SEP-24 settlement note in the pitch.
          </p>
        </div>
      </main>
    </div>
  );
}
