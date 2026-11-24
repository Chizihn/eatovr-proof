/**
 * A donor picks a meal-count tier, never a raw amount — see
 * docs/BUILDATHON-PLAN.md's Sponsor Food section for why: it's N
 * discrete, identically-valued units from creation, not something
 * split at redemption time.
 *
 * `MEAL_PRICE_NGN` and `DEMO_NGN_PER_USD` are both illustrative demo
 * constants, not live data: `MEAL_PRICE_NGN` should be pinned to
 * Eatovr's actual typical discounted-meal price once that's known,
 * and the NGN->USD leg is a fixed, explicitly-labeled demo rate
 * because Reflector's Fiat FX feed has no NGN pair at all (verified
 * live against testnet — see reflector/client.ts). The USDC-per-meal
 * value this produces is what actually gets escrowed on-chain.
 */
export const MEAL_PRICE_NGN = 1_500;
export const DEMO_NGN_PER_USD = 1_650;

export const UNIT_VALUE_USDC = (MEAL_PRICE_NGN / DEMO_NGN_PER_USD).toFixed(2);

export type SponsorshipTier = {
  id: "1" | "5" | "10";
  unitCount: number;
  label: string;
};

export const SPONSORSHIP_TIERS: SponsorshipTier[] = [
  { id: "1", unitCount: 1, label: "Sponsor 1 meal" },
  { id: "5", unitCount: 5, label: "Sponsor 5 meals" },
  { id: "10", unitCount: 10, label: "Sponsor 10 meals" },
];

export function tierById(id: string): SponsorshipTier {
  const tier = SPONSORSHIP_TIERS.find((t) => t.id === id);
  if (!tier) {
    throw new Error(`Unknown sponsorship tier: ${id}`);
  }
  return tier;
}

export function batchTotalUsdc(unitCount: number): string {
  return (unitCount * Number(UNIT_VALUE_USDC)).toFixed(2);
}
