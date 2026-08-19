/**
 * Week resolution — the tie-doubling rule (D17, D17a).
 *
 * Let R be the picks required this week. Resolve as:
 *
 *   ANY pick loses            -> loss. Other results are irrelevant.
 *   No losses, T ties         -> survives; next week requires (multiplier x T).
 *   No losses, no ties        -> survives; next week requires 1.
 *
 * Wins never offset or pay down a tie. A tie in the final week is a loss,
 * because there is no following week in which to pay the debt (D17a).
 */

import type { SeasonConfig } from "./config";
import type { PickOutcome, WeekNumber } from "./types";

export type WeekVerdict = "survived" | "lost" | "pending";

export interface WeekResolution {
  verdict: WeekVerdict;
  /** Picks required next week. Only meaningful when verdict is "survived". */
  nextRequiredPicks: number;
  ties: number;
  losses: number;
  wins: number;
  /** Human-readable rationale, surfaced to player and commissioner. */
  reason: string;
}

/**
 * Resolve one week for one entry.
 *
 * `outcomes` must contain one entry per pick the entry was required to make.
 * If any game is not yet final the week resolves as "pending" — an unfinished
 * or postponed game must never advance or eliminate anyone (PROJECT_BRIEF).
 */
export function resolveWeek(
  outcomes: readonly PickOutcome[],
  week: WeekNumber,
  config: SeasonConfig,
): WeekResolution {
  const wins = outcomes.filter((o) => o === "win").length;
  const losses = outcomes.filter((o) => o === "loss").length;
  const ties = outcomes.filter((o) => o === "tie").length;
  const pending = outcomes.filter((o) => o === "pending").length;

  if (outcomes.length === 0) {
    return {
      verdict: "lost",
      nextRequiredPicks: 0,
      ties,
      losses,
      wins,
      reason: "No picks were made or assigned for this week.",
    };
  }

  // A loss is decisive and does not need the rest of the week to be final.
  if (losses > 0) {
    return {
      verdict: "lost",
      nextRequiredPicks: 0,
      ties,
      losses,
      wins,
      reason:
        outcomes.length === 1
          ? "Pick lost."
          : `${losses} of ${outcomes.length} required picks lost. Any loss in a multi-pick week is a loss.`,
    };
  }

  if (pending > 0) {
    return {
      verdict: "pending",
      nextRequiredPicks: 0,
      ties,
      losses,
      wins,
      reason: `${pending} of ${outcomes.length} game(s) not final yet.`,
    };
  }

  if (ties > 0) {
    if (config.tieInFinalWeekIsLoss && week >= config.finalWeek) {
      return {
        verdict: "lost",
        nextRequiredPicks: 0,
        ties,
        losses,
        wins,
        reason:
          `Tie in Week ${week}, the final week. There is no following week in which ` +
          `to meet the doubled requirement, so a tie here is a loss. ` +
          `You do not advance on a tie.`,
      };
    }

    const next = config.tieMultiplier * ties;
    return {
      verdict: "survived",
      nextRequiredPicks: next,
      ties,
      losses,
      wins,
      reason:
        `${ties} tie(s) this week. A tie is neither a win nor a loss: it must be ` +
        `made good with ${config.tieMultiplier} wins each. Week ${week + 1} requires ` +
        `${next} winning picks. Wins this week do not reduce that.`,
    };
  }

  return {
    verdict: "survived",
    nextRequiredPicks: 1,
    ties,
    losses,
    wins,
    reason:
      outcomes.length === 1
        ? "Pick won. Next week is a normal single-pick week."
        : `All ${wins} required picks won. Requirement clears; next week is a normal single-pick week.`,
  };
}

/** Outcome of a single pick from a final score. */
export function outcomeFor(
  pickedTeamId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number | null,
  awayScore: number | null,
  isFinal: boolean,
): PickOutcome {
  if (!isFinal || homeScore === null || awayScore === null) return "pending";
  if (homeScore === awayScore) return "tie";

  const winnerId = homeScore > awayScore ? homeTeamId : awayTeamId;
  if (pickedTeamId !== homeTeamId && pickedTeamId !== awayTeamId) {
    throw new Error(
      `Pick ${pickedTeamId} is not a participant in this game (${awayTeamId} at ${homeTeamId}).`,
    );
  }
  return pickedTeamId === winnerId ? "win" : "loss";
}
