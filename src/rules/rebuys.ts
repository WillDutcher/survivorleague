/**
 * Rebuy eligibility and pricing (D20).
 *
 * Eligibility keys off the week the LOSS occurred, not the week of re-entry.
 * So a Week 5 loss buys back in for Week 6, but a Week 6 loss ends the entry.
 *
 *   $80 — 3 included rebuys for losses in Weeks 1-8. Unused rebuys EXPIRE:
 *         a clean sheet with all 3 unused plus a Week 9 loss is elimination.
 *         Nothing is ever purchasable on this tier.
 *
 *   $20 — unlimited rebuys, but only for losses in Weeks 1-5.
 *         Week 1 loss costs $10 (exclusive to this tier and this week).
 *         Weeks 2-5 cost $30, no exceptions. A Week 6+ loss ends the entry.
 */

import { tierConfig, type SeasonConfig } from "./config";
import type { EntryState, WeekNumber } from "./types";

export interface RebuyOffer {
  kind: "included" | "paid";
  priceCents: number;
  lossWeek: WeekNumber;
  /** Shown to the player at the moment they decide. */
  description: string;
}

export interface RebuyEligibility {
  offers: RebuyOffer[];
  /** Populated when there are no offers, so the player learns why. */
  ineligibleReason: string | null;
}

/**
 * What, if anything, this entry may do after losing in `lossWeek`.
 *
 * Returns every applicable offer. In practice a tier yields at most one, but
 * the shape allows a future season to offer a choice without a rewrite.
 */
export function rebuyOptionsFor(
  entry: EntryState,
  lossWeek: WeekNumber,
  config: SeasonConfig,
): RebuyEligibility {
  const tier = tierConfig(config, entry.tier);
  const offers: RebuyOffer[] = [];

  // Included rebuys ($80 tier). Expire after the configured week.
  const hasIncludedProgram = tier.includedRebuys > 0;
  const withinIncludedWindow = lossWeek <= tier.includedRebuyThroughWeek;
  if (hasIncludedProgram && withinIncludedWindow && entry.includedRebuysRemaining > 0) {
    const remainingAfter = entry.includedRebuysRemaining - 1;
    offers.push({
      kind: "included",
      priceCents: 0,
      lossWeek,
      description:
        `Included rebuy — no charge. ${entry.includedRebuysRemaining} remaining before this one, ` +
        `${remainingAfter} after. Usable through Week ${tier.includedRebuyThroughWeek}; ` +
        `unused rebuys expire after that.`,
    });
  }

  // Purchasable rebuys ($20 tier). Unlimited within their week windows.
  for (const rule of tier.paidRebuyRules) {
    if (lossWeek >= rule.fromWeek && lossWeek <= rule.toWeek) {
      offers.push({
        kind: "paid",
        priceCents: rule.priceCents,
        lossWeek,
        description: `Rebuy for ${formatCents(rule.priceCents)}.`,
      });
    }
  }

  return {
    offers,
    ineligibleReason: offers.length > 0 ? null : explainIneligible(entry, lossWeek, config),
  };
}

function explainIneligible(
  entry: EntryState,
  lossWeek: WeekNumber,
  config: SeasonConfig,
): string {
  const tier = tierConfig(config, entry.tier);

  if (tier.includedRebuys > 0) {
    if (lossWeek > tier.includedRebuyThroughWeek) {
      return (
        `No rebuys are available after Week ${tier.includedRebuyThroughWeek} on the ` +
        `${tier.label} under any circumstance, and none can be purchased. ` +
        `This loss in Week ${lossWeek} ends the entry.`
      );
    }
    return (
      `All ${tier.includedRebuys} included rebuys on the ${tier.label} have been used, ` +
      `and additional rebuys cannot be purchased. This loss ends the entry.`
    );
  }

  const lastPaidWeek = tier.paidRebuyRules.reduce((max, r) => Math.max(max, r.toWeek), 0);
  return (
    `Rebuys on the ${tier.label} are available only for losses through Week ${lastPaidWeek}. ` +
    `This loss in Week ${lossWeek} ends the entry.`
  );
}

/**
 * The requirement an entry carries after completing a rebuy.
 * A rebuy clears any outstanding tie debt but never clears used-team history (D17b).
 */
export function requiredPicksAfterRebuy(config: SeasonConfig, currentRequirement: number): number {
  return config.rebuyClearsTieDebt ? 1 : currentRequirement;
}

export function formatCents(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
