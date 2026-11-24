import { CheckCircle2, ExternalLink, Hourglass, Soup } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  getAttestations,
  stellarExpertTxUrl,
  truncateAddress,
  type Attestation,
} from "@/lib/attestations";
import { cn } from "cn";

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof Soup;
  tone: "primary" | "success" | "warning";
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl",
            tone === "primary" && "bg-primary/10 text-primary",
            tone === "success" && "bg-success/10 text-success",
            tone === "warning" && "bg-warning/10 text-warning",
          )}
        >
          <Icon className="size-6" />
        </div>
        <div>
          <p className="text-3xl font-semibold tabular-nums">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TxButton({ hash, label }: { hash: string; label: string }) {
  return (
    <Button
      variant="outline"
      size="xs"
      render={
        <a href={stellarExpertTxUrl(hash)} target="_blank" rel="noopener noreferrer" />
      }
    >
      {label}
      <ExternalLink />
    </Button>
  );
}

export default async function Home() {
  let attestations: Attestation[] = [];
  let fetchError: string | null = null;

  try {
    attestations = await getAttestations();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Unknown error";
  }

  const finalized = attestations.filter((a) => a.status === "Finalized");
  const pending = attestations.filter((a) => a.status === "Pending");
  const mealsRescued = finalized.reduce((sum, a) => sum + a.quantity, 0);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-10">
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

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-8 sm:px-10">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Verified meals rescued
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Read straight from the chain, not from Eatovr&apos;s own
            reporting. Every record only exists because the vendor{" "}
            <em>and</em> the recipient independently confirmed it.
          </p>
        </div>

        {fetchError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t reach the Attestation Service</AlertTitle>
            <AlertDescription>{fetchError}</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                icon={Soup}
                tone="primary"
                label="Verified meals rescued"
                value={mealsRescued}
              />
              <StatCard
                icon={CheckCircle2}
                tone="success"
                label="Confirmed pickups"
                value={finalized.length}
              />
              <StatCard
                icon={Hourglass}
                tone="warning"
                label="Awaiting confirmation"
                value={pending.length}
              />
            </div>

            <Card className="flex-1">
              <CardHeader>
                <CardTitle>Verified records</CardTitle>
                <CardDescription>
                  Newest first. Both links go to the actual on-chain
                  transaction — anyone can check these independently.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {finalized.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No pickups have been independently confirmed by both
                    parties yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Confirmed</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead className="text-right">On-chain</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {finalized.map((a) => (
                        <TableRow key={a.orderId}>
                          <TableCell className="font-medium capitalize">
                            {a.itemType.replaceAll("_", " ")}
                          </TableCell>
                          <TableCell className="tabular-nums">{a.quantity}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {a.confirmedAt
                              ? new Date(a.confirmedAt).toLocaleString()
                              : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {truncateAddress(a.vendor)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {truncateAddress(a.recipient)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1.5">
                              <TxButton hash={a.claimTxHash} label="claim" />
                              {a.confirmTxHash ? (
                                <TxButton hash={a.confirmTxHash} label="confirm" />
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-6 text-xs text-muted-foreground sm:px-10">
          <Badge variant="outline">Testnet</Badge>
          <p>
            Seeded demo accounts, not a live pilot — this is the
            verification layer proven end-to-end, ready to activate for
            the first real vendor.
          </p>
        </div>
      </footer>
    </div>
  );
}
