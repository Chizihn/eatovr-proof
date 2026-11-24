import { scValToNative } from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { sorobanServer } from "./client.js";
import { withRetry } from "./retry.js";

export type ClaimedEvent = {
  type: "claimed";
  orderId: string;
  vendor: string;
  recipient: string;
  itemType: string;
  quantity: number;
  ledgerClosedAt: string;
  txHash: string;
};

export type FinalizedEvent = {
  type: "finalized";
  orderId: string;
  vendor: string;
  recipient: string;
  itemType: string;
  quantity: number;
  claimedAt: bigint;
  confirmedAt: bigint;
  ledgerClosedAt: string;
  txHash: string;
};

export type AttestationEvent = ClaimedEvent | FinalizedEvent;

/**
 * Polls Soroban RPC's `getEvents` for AttestationRegistry events from
 * `startLedger` onward, and decodes them into plain JS records. This is
 * the only place that knows the wire shape of our contract's events.
 */
export async function fetchEventsSince(startLedger: number): Promise<{
  events: AttestationEvent[];
  latestLedger: number;
}> {
  const response = await withRetry(() =>
    sorobanServer.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [config.contractId],
        },
      ],
    }),
  );

  const events: AttestationEvent[] = [];

  for (const raw of response.events) {
    const topic = raw.topic.map((t) => scValToNative(t));
    const kind = topic[0];
    const orderId = topic[1] as string;
    const fields = scValToNative(raw.value) as unknown[];

    if (kind === "claimed") {
      const [vendor, recipient, itemType, quantity] = fields as [
        string,
        string,
        string,
        number,
      ];
      events.push({
        type: "claimed",
        orderId,
        vendor,
        recipient,
        itemType,
        quantity,
        ledgerClosedAt: raw.ledgerClosedAt,
        txHash: raw.txHash,
      });
    } else if (kind === "finalized") {
      const [vendor, recipient, itemType, quantity, claimedAt, confirmedAt] = fields as [
        string,
        string,
        string,
        number,
        bigint,
        bigint,
      ];
      events.push({
        type: "finalized",
        orderId,
        vendor,
        recipient,
        itemType,
        quantity,
        claimedAt: BigInt(claimedAt),
        confirmedAt: BigInt(confirmedAt),
        ledgerClosedAt: raw.ledgerClosedAt,
        txHash: raw.txHash,
      });
    }
  }

  return { events, latestLedger: response.latestLedger };
}
