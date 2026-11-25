/**
 * A donor picks a meal-count tier, never a raw amount — see
 * docs/BUILDATHON-PLAN.md's Sponsor Food section for why: it's N
 * discrete, identically-valued units from creation, not something
 * split at redemption time.
 *
 * Priced per currency, not just NGN — the Buildathon targets both
 * Nigeria and Ghana, and a Sponsor Food that only understood NGN
 * would quietly shut out half the hackathon's own target market (and
 * score worse on "could this work beyond one country" than it should
 * for something this close to launching real international reach).
 * `MEAL_PRICE_BY_CURRENCY` and `DEMO_RATE_PER_USD` are both
 * illustrative demo constants, not live data: the NGN/GHS prices
 * should be pinned to Eatovr's actual typical discounted-meal price
 * per market once known, and the ->USD leg is a fixed, explicitly-
 * labeled demo rate because Reflector's Fiat FX feed has neither an
 * NGN nor a GHS pair at all (verified live against testnet — see
 * reflector/client.ts). The USDC-per-meal value this produces is
 * what actually gets escrowed on-chain.
 */
export type SponsorshipCurrency = "NGN" | "GHS";

export const DEFAULT_SPONSORSHIP_CURRENCY: SponsorshipCurrency = "NGN";

export const MEAL_PRICE_BY_CURRENCY: Record<SponsorshipCurrency, number> = {
  NGN: 1_500,
  GHS: 15,
};

export const DEMO_RATE_PER_USD: Record<SponsorshipCurrency, number> = {
  NGN: 1_650,
  GHS: 14.5,
};

export function isSponsorshipCurrency(value: string): value is SponsorshipCurrency {
  return value === "NGN" || value === "GHS";
}

export function mealPriceInCurrency(currency: SponsorshipCurrency): number {
  return MEAL_PRICE_BY_CURRENCY[currency];
}

export function unitValueUsdc(currency: SponsorshipCurrency): string {
  return (MEAL_PRICE_BY_CURRENCY[currency] / DEMO_RATE_PER_USD[currency]).toFixed(2);
}

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

export function batchTotalUsdc(unitCount: number, currency: SponsorshipCurrency): string {
  return (unitCount * Number(unitValueUsdc(currency))).toFixed(2);
}
