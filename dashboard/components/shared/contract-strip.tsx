"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { stellarExpertContractUrl } from "@/lib/attestations";

/**
 * The deployed contract this entire dashboard reads from — an
 * explorer always foregrounds the specific contract/address being
 * tracked so a visitor can go verify it themselves, independent of
 * anything rendered here.
 */
export function ContractStrip({ contractId }: { contractId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(contractId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border-b bg-muted/40">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-2 text-xs sm:px-10">
        <span className="shrink-0 text-muted-foreground">AttestationRegistry</span>
        <code className="truncate font-mono text-foreground">{contractId}</code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Copy contract address"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
        <a
          href={stellarExpertContractUrl(contractId)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          View on Stellar Expert
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
