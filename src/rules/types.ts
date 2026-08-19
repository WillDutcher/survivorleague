/**
 * Domain types for the Survivor League rule engine.
 *
 * This module and everything else under `src/rules/` is PURE:
 * no database, no network, no framework imports, no clock reads.
 * Every function takes its inputs explicitly — including `now` — so that
 * every league rule is testable without fixtures, mocks, or a running app.
 *
 * See ARCHITECTURE.md ("The organizing principle") and DECISIONS.md.
 */

export type TeamId = string; // canonical abbreviation, e.g. "PHI"
export type GameId = string;
export type EntryId = string;

/** NFL regular-season week. 1..18 (see SeasonConfig.finalWeek). */
export type WeekNumber = number;

export type Conference = "AFC" | "NFC";
export type Division = "East" | "North" | "South" | "West";

export interface Team {
  id: TeamId;
  city: string;
  name: string;
  conference: Conference;
  division: Division;
  /** Used for pick controls. Never depend on NFL logos (PROJECT_BRIEF). */
  colors: { primary: string; secondary: string };
}

/**
 * Game lifecycle. Results are only ever processed from `final`.
 * A `postponed` or `in_progress` game must never advance or eliminate anyone.
 */
export type GameStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "canceled";

export interface Game {
  id: GameId;
  week: WeekNumber;
  awayTeamId: TeamId;
  homeTeamId: TeamId;
  /** Absolute instant. Timezone conversion is a display concern. */
  kickoff: Date;
  status: GameStatus;
  awayScore: number | null;
  homeScore: number | null;
}

/**
 * A locked league line (D10). Informational for players (D16) and used only
 * to rank default picks (D18) — never to decide whether anyone survives.
 */
export interface LeagueLine {
  gameId: GameId;
  /** null means pick'em / no favorite. */
  favoriteTeamId: TeamId | null;
  /** Positive magnitude of the spread, e.g. 9.5 for a 9.5-point favorite. */
  spread: number;
}

export type EntryTier = "TWENTY" | "EIGHTY";

/** Entry lifecycle (D5). Unpaid entries hold no roster spot and no pot share. */
export type EntryStatus =
  | "registered"
  | "paid"
  | "active"
  | "rebuy_pending"
  | "eliminated"
  | "winner"
  | "settled";

/** Outcome of one pick, once its game is final. */
export type PickOutcome = "win" | "loss" | "tie" | "pending";

export type PickSource = "player" | "default" | "commissioner";

export interface Pick {
  entryId: EntryId;
  week: WeekNumber;
  /** Multiple picks per week are possible under the tie rule (D17). */
  slot: number;
  teamId: TeamId;
  gameId: GameId;
  source: PickSource;
  lockAt: Date;
}

/**
 * Everything the rule engine needs to know about an entry at a point in time.
 * Assembled by the persistence layer; the engine never queries for it.
 */
export interface EntryState {
  id: EntryId;
  tier: EntryTier;
  status: EntryStatus;
  /**
   * Every team this entry has committed to in any week, past or future.
   * Survives rebuys and never resets (PROJECT_BRIEF, D17b).
   */
  committedTeamIds: readonly TeamId[];
  /**
   * Picks required this week. Normally 1; 2 x ties after a tie week (D17).
   * Reset to 1 by a rebuy (D17b).
   */
  requiredPicks: number;
  /** $80 tier only. Expires after includedRebuyThroughWeek (D20). */
  includedRebuysRemaining: number;
}
