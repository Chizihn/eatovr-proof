/**
 * The single most important "this is really reading from a chain"
 * signal an explorer gives you — which network, and that it's alive
 * — so it belongs in the header, not buried in the footer disclaimer.
 */
export function NetworkBadge() {
  return (
    <div className="inline-flex h-6 items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 text-xs font-semibold text-success">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      Stellar Testnet
    </div>
  );
}
