/**
 * Season configuration.
 *
 * Every league rule that could plausibly change between seasons lives here as
 * data, not as a literal buried in logic. Two reasons:
 *
 *  1. The commissioner can change prices and windows without a code change (D3).
 *  2. The player-facing rules page renders from this same object (D18a), so the
 *     published rules and the enforced behavior cannot drift apart. Drift is
 *     what starts arguments.
 */

import type { EntryTier } from "./types";

/** A purchasable rebuy price for losses in an inclusive week range (D20). */
export interface PaidRebuyRule {
  fromWeek: number;
  toWeek: number;
  priceCents: number;
}

export interface TierConfig {
  id: EntryTier;
  label: string;
  entryFeeCents: number;
  /** Rebuys granted with the entry. $80 tier only. */
  includedRebuys: number;
  /** Included rebuys are usable for losses up to and including this week. 0 = none. */
  includedRebuyThroughWeek: number;
  /** Purchasable rebuys. Empty means none are ever purchasable. */
  paidRebuyRules: readonly PaidRebuyRule[];
}

export interface SeasonConfig {
  year: number;
  /** Practice seasons have $0 entries, no payment gate, no settlement (D12). */
  mode: "practice" | "live";
  /** Last regular-season week. The season never extends into the playoffs (D17a). */
  finalWeek: number;
  /** League rule timezone. All deadlines are expressed in this zone. */
  timezone: string;
  /** Normal Sunday submission deadline, in `timezone`. */
  sundayDeadline: { hour: number; minute: number };
  /** A pick on a game kicking off before the Sunday deadline locks this many minutes early. */
  earlyGameLockLeadMinutes: number;
  /** Picks required next week per tie this week (D17): next = max(1, multiplier x ties). */
  tieMultiplier: number;
  /** A tie in the final week is a loss — there is no week left to pay the debt (D17a). */
  tieInFinalWeekIsLoss: boolean;
  /** A rebuy resets the pick requirement to 1; used-team history still carries (D17b). */
  rebuyClearsTieDebt: boolean;
  tiers: readonly TierConfig[];
}

/**
 * The 2026 league rules as ruled by the commissioner. See DECISIONS.md D3, D20.
 *
 * Note the deliberate asymmetry between tiers: the $20 tier's $30 rebuy is
 * priced to push players toward the $80 option.
 */
export const SEASON_2026: SeasonConfig = {
  year: 2026,
  mode: "live",
  finalWeek: 18,
  timezone: "America/New_York",
  sundayDeadline: { hour: 12, minute: 55 },
  earlyGameLockLeadMinutes: 5,
  tieMultiplier: 2,
  tieInFinalWeekIsLoss: true,
  rebuyClearsTieDebt: true,
  tiers: [
    {
      id: "TWENTY",
      label: "$20 entry",
      entryFeeCents: 2000,
      includedRebuys: 0,
      includedRebuyThroughWeek: 0,
      paidRebuyRules: [
        // Week 1 only, and exclusive to this tier.
        { fromWeek: 1, toWeek: 1, priceCents: 1000 },
        // Weeks 2-5. No exceptions. Unlimited within the window.
        { fromWeek: 2, toWeek: 5, priceCents: 3000 },
        // A loss in Week 6 or later ends the entry.
      ],
    },
    {
      id: "EIGHTY",
      label: "$80 entry",
      entryFeeCents: 8000,
      includedRebuys: 3,
      // Unused included rebuys EXPIRE after Week 8 (D20).
      includedRebuyThroughWeek: 8,
      // Nothing is ever purchasable on this tier.
      paidRebuyRules: [],
    },
  ],
};

export function tierConfig(config: SeasonConfig, tier: EntryTier): TierConfig {
  const found = config.tiers.find((t) => t.id === tier);
  if (!found) {
    throw new Error(`Season ${config.year} has no configuration for tier ${tier}`);
  }
  return found;
}
