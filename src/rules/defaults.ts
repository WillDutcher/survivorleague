/**
 * Deterministic default picks (PROJECT_BRIEF; D18).
 *
 * When an active entry misses the deadline, it is assigned the strongest
 * available favorite by the locked league line, from the teams still legal for
 * that entry. In a multi-pick week (D17) the top N are assigned.
 *
 * Spreads are informational for players (D16); this is the one place a line
 * influences a decision, and even here it only decides WHICH team an absent
 * player receives — never whether anyone survives.
 *
 * Determinism is the whole point. The inputs (the Thursday-locked snapshot and
 * the entry's committed teams) are frozen before the deadline, so the result
 * computed at 12:59 and the result computed hours later are identical. That is
 * what makes a missed cron fire an embarrassment rather than a corruption.
 */

import type { SeasonConfig } from "./config";
import { legalTeamsFor, type AvailabilityOptions } from "./eligibility";
import type { EntryState, Game, LeagueLine, TeamId, WeekNumber } from "./types";

export interface Candidate {
  teamId: TeamId;
  gameId: string;
  /** Points this team is favored by. Negative if an underdog, 0 at pick'em. */
  lineValue: number;
  isHome: boolean;
  kickoff: Date;
}

export interface DefaultAssignment {
  teamId: TeamId;
  gameId: string;
  lineValue: number;
  /** Why this team, in words, for the audit record and the player's dashboard. */
  rationale: string;
}

export interface DefaultPickResult {
  assignments: DefaultAssignment[];
  /** Every candidate considered, ranked. Stored with the pick for audit. */
  candidatesConsidered: Candidate[];
  /** True when fewer legal teams existed than the entry required (D17c). */
  shortfall: boolean;
  ruleVersion: string;
}

export const DEFAULT_PICK_RULE_VERSION = "strongest-legal-favorite@1";

/**
 * Rank legal teams strongest-first.
 *
 * Ordering, in strict priority:
 *   1. line value descending  — biggest favorite first; underdogs sort below
 *      every favorite, least-bad first, so the ordering stays total even when
 *      an entry has burned all the favorites.
 *   2. home team preferred    — brief's first tie-break
 *   3. earliest kickoff       — brief's second tie-break; also yields the
 *      historical early Sunday / late Sunday / SNF / Monday window order
 *   4. team id ascending      — final backstop so the result is never
 *      dependent on input array order
 */
export function rankCandidates(
  legalTeamIds: readonly TeamId[],
  gamesThisWeek: readonly Game[],
  lines: readonly LeagueLine[],
): Candidate[] {
  const lineByGame = new Map(lines.map((l) => [l.gameId, l]));
  const legal = new Set(legalTeamIds);
  const candidates: Candidate[] = [];

  for (const game of gamesThisWeek) {
    const line = lineByGame.get(game.id);
    for (const teamId of [game.awayTeamId, game.homeTeamId]) {
      if (!legal.has(teamId)) continue;

      let lineValue = 0;
      if (line && line.favoriteTeamId !== null) {
        lineValue = line.favoriteTeamId === teamId ? line.spread : -line.spread;
      }

      candidates.push({
        teamId,
        gameId: game.id,
        lineValue,
        isHome: teamId === game.homeTeamId,
        kickoff: game.kickoff,
      });
    }
  }

  return candidates.sort((a, b) => {
    if (a.lineValue !== b.lineValue) return b.lineValue - a.lineValue;
    if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
    if (a.kickoff.getTime() !== b.kickoff.getTime()) {
      return a.kickoff.getTime() - b.kickoff.getTime();
    }
    return a.teamId < b.teamId ? -1 : 1;
  });
}

/**
 * Assign default picks for one entry in one week.
 * Assigns `entry.requiredPicks` teams, or every legal team if fewer exist.
 */
export function defaultPicksFor(
  entry: EntryState,
  gamesThisWeek: readonly Game[],
  lines: readonly LeagueLine[],
  week: WeekNumber,
  _config: SeasonConfig,
  options: AvailabilityOptions = {},
): DefaultPickResult {
  const legal = legalTeamsFor(entry, gamesThisWeek, options);
  const ranked = rankCandidates(legal, gamesThisWeek, lines);
  const needed = entry.requiredPicks;
  const chosen = ranked.slice(0, needed);

  const assignments = chosen.map((c, index) => ({
    teamId: c.teamId,
    gameId: c.gameId,
    lineValue: c.lineValue,
    rationale: describe(c, index, needed, ranked.length, week),
  }));

  return {
    assignments,
    candidatesConsidered: ranked,
    shortfall: ranked.length < needed,
    ruleVersion: DEFAULT_PICK_RULE_VERSION,
  };
}

function describe(
  c: Candidate,
  index: number,
  needed: number,
  poolSize: number,
  week: WeekNumber,
): string {
  const strength =
    c.lineValue > 0
      ? `favored by ${c.lineValue}`
      : c.lineValue === 0
        ? "a pick'em"
        : `an underdog by ${Math.abs(c.lineValue)}`;

  const rank =
    needed > 1
      ? `Ranked ${index + 1} of ${needed} required picks (from ${poolSize} legal teams)`
      : `Strongest legal favorite of ${poolSize} available teams`;

  return (
    `No pick was submitted for Week ${week} before the deadline. ` +
    `${rank}: ${c.teamId}, ${strength} on the locked league line.`
  );
}
