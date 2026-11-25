/**
 * Mirrors service/prisma/schema.prisma's enums — not type-shared
 * (this script only talks to the service over HTTP), so these have
 * to be kept in sync by hand if the service's enums ever change. Same
 * mirroring approach as dashboard/lib/attestations.ts.
 */
export const AttestationStatus = {
  Pending: "Pending",
  Finalized: "Finalized",
} as const;
export type AttestationStatus = (typeof AttestationStatus)[keyof typeof AttestationStatus];

export const OrderCategory = {
  commercial: "commercial",
  donation_recovery: "donation_recovery",
} as const;
export type OrderCategory = (typeof OrderCategory)[keyof typeof OrderCategory];

export const SponsorshipUnitStatus = {
  Pending: "Pending",
  Available: "Available",
  Claimed: "Claimed",
  Redeemed: "Redeemed",
} as const;
export type SponsorshipUnitStatus = (typeof SponsorshipUnitStatus)[keyof typeof SponsorshipUnitStatus];
