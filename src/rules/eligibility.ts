/**
 * No-reuse enforcement and pick legality (PROJECT_BRIEF).
 *
 * A team may be used at most once per entry per season. The prohibition survives
 * rebuys — a team burned before a loss stays burned after re-entry (D17b).
 *
 * "Committed" covers past picks AND future reservations, so selecting a team for
 * Week 9 makes it unavailable in Week 4 and vice versa.
 *
 * The UI must render every one of these reasons distinctly. A previously used
 * team must not look selectable, and an illegal selection must explain itself.
 */

import type { EntryState, Game, TeamId, WeekNumber } from "./types";

export type UnavailableReason =
  | "already_used"
  | "reserved_other_week"
  | "not_playing"
  | "locked"
  | "game_not_playable";

export interface TeamAvailability {
  teamId: TeamId;
  gameId: string | null;
  available: boolean;
  reason: UnavailableReason | null;
  explanation: string | null;
}

export interface AvailabilityOptions {
  /** Teams this entry already holds for THIS week — selectable so a pick can be changed. */
  currentWeekTeamIds?: readonly TeamId[];
  /** Team -> week, for picks committed in other weeks. Enables a precise message. */
  reservedInWeek?: ReadonlyMap<TeamId, WeekNumber>;
  /** Lock instant per game. Omit to ignore lock state. */
  lockAtByGameId?: ReadonlyMap<string, Date>;
  now?: Date;
  /**
   * The week being viewed. Lets the message distinguish a team already SPENT in
   * an earlier week from one RESERVED for a later one — the difference matters
   * to a player deciding what to do next.
   */
  viewingWeek?: WeekNumber;
}

/**
 * Full availability picture for every team playing in `gamesThisWeek`.
 * Returns one row per team so the UI can explain each unavailable option.
 */
export function teamAvailability(
  entry: EntryState,
  gamesThisWeek: readonly Game[],
  options: AvailabilityOptions = {},
): TeamAvailability[] {
  const currentWeek = new Set(options.currentWeekTeamIds ?? []);
  const committed = new Set(entry.committedTeamIds);
  const rows: TeamAvailability[] = [];

  for (const game of gamesThisWeek) {
    for (const teamId of [game.awayTeamId, game.homeTeamId]) {
      const playable = game.status === "scheduled" || game.status === "in_progress";
      if (!playable) {
        rows.push({
          teamId,
          gameId: game.id,
          available: false,
          reason: "game_not_playable",
          explanation: `That game is ${game.status.replace("_", " ")}.`,
        });
        continue;
      }

      // A team already picked for this week stays selectable so the pick can be changed.
      if (committed.has(teamId) && !currentWeek.has(teamId)) {
        const committedWeek = options.reservedInWeek?.get(teamId);
        if (committedWeek !== undefined) {
          const viewing = options.viewingWeek;
          const isFutureReservation = viewing !== undefined && committedWeek > viewing;
          rows.push({
            teamId,
            gameId: game.id,
            available: false,
            reason: isFutureReservation ? "reserved_other_week" : "already_used",
            explanation: isFutureReservation
              ? `Reserved for your Week ${committedWeek} pick.`
              : `You used this team in Week ${committedWeek}.`,
          });
        } else {
          rows.push({
            teamId,
            gameId: game.id,
            available: false,
            reason: "already_used",
            explanation: "You have already used this team this season.",
          });
        }
        continue;
      }

      const lockAt = options.lockAtByGameId?.get(game.id);
      if (lockAt && options.now && options.now.getTime() >= lockAt.getTime()) {
        rows.push({
          teamId,
          gameId: game.id,
          available: false,
          reason: "locked",
          explanation: "This game is past its lock time.",
        });
        continue;
      }

      rows.push({ teamId, gameId: game.id, available: true, reason: null, explanation: null });
    }
  }

  return rows;
}

/** Just the legal team ids, in stable order. */
export function legalTeamsFor(
  entry: EntryState,
  gamesThisWeek: readonly Game[],
  options: AvailabilityOptions = {},
): TeamId[] {
  return teamAvailability(entry, gamesThisWeek, options)
    .filter((r) => r.available)
    .map((r) => r.teamId);
}

export type PickRejection = {
  ok: false;
  reason: UnavailableReason | "not_active" | "unknown_team";
  message: string;
};
export type PickAcceptance = { ok: true; gameId: string; lockAt: Date | null };
export type PickValidation = PickAcceptance | PickRejection;

/**
 * Server-side validation for a single pick submission.
 * Deadline enforcement happens here, never in the browser.
 */
export function validatePick(
  entry: EntryState,
  teamId: TeamId,
  gamesThisWeek: readonly Game[],
  options: AvailabilityOptions = {},
): PickValidation {
  if (entry.status !== "active") {
    return {
      ok: false,
      reason: "not_active",
      message:
        entry.status === "registered" || entry.status === "paid"
          ? "Your entry is not active yet. Picks count once your entry is paid and confirmed."
          : `Your entry is ${entry.status.replace("_", " ")} and cannot submit picks.`,
    };
  }

  const rows = teamAvailability(entry, gamesThisWeek, options);
  const row = rows.find((r) => r.teamId === teamId);

  if (!row) {
    return {
      ok: false,
      reason: "unknown_team",
      message: "That team does not play this week.",
    };
  }

  if (!row.available) {
    return {
      ok: false,
      reason: row.reason ?? "already_used",
      message: row.explanation ?? "That team is not available.",
    };
  }

  return {
    ok: true,
    gameId: row.gameId as string,
    lockAt: options.lockAtByGameId?.get(row.gameId as string) ?? null,
  };
}

/**
 * Whether an entry can field its required number of picks this week (D17c).
 * Effectively unreachable, but defined so the engine has no undefined branch.
 */
export function canMeetRequirement(
  entry: EntryState,
  gamesThisWeek: readonly Game[],
  options: AvailabilityOptions = {},
): boolean {
  return legalTeamsFor(entry, gamesThisWeek, options).length >= entry.requiredPicks;
}
