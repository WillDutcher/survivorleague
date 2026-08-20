/**
 * League standings.
 *
 * VISIBILITY RULE
 * Another player's pick is hidden until THAT PICK'S GAME HAS KICKED OFF — not
 * merely until picks lock. The two differ: a Monday-night pick locks at Sunday
 * 12:55 but does not kick off for another thirty hours, and revealing it in
 * between tells everyone something they cannot act on and did not need.
 *
 * A pick that has been made but not revealed still SHOWS AS MADE. "Hidden" and
 * "hasn't picked yet" are different facts, and conflating them is the kind of
 * ambiguity people argue about.
 *
 * The commissioner is exempt: `revealAll` shows every pick immediately. Running
 * the league means answering "did everyone pick?" and fixing bad picks before
 * kickoff, which is impossible through the players' view.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { entries, games, picks, users, weeks } from "@/db/schema";
import { tierConfig, type SeasonConfig } from "@/rules/config";
import type { EntryTier } from "@/rules/types";

export interface StandingPick {
  week: number;
  teamId: string;
  outcome: string;
  source: string;
}

export interface StandingRow {
  entryId: string;
  name: string;
  tier: EntryTier;
  tierLabel: string;
  status: string;
  requiredPicks: number;
  includedRebuysRemaining: number;
  /** Plain-language rebuy position, which differs completely by tier. */
  rebuyLabel: string;
  eliminatedAtWeek: number | null;
  /** Picks whose game has kicked off. Open history. */
  history: StandingPick[];
  usedTeamCount: number;
  /** This week's pick, once its game has started. */
  currentPick: string | null;
  /** True when a pick exists for this week but its game has not started. */
  currentPickHidden: boolean;
}

export interface StandingsOptions {
  now?: Date;
  /**
   * Show every pick regardless of kickoff. Commissioner-only: the admin view
   * needs the full picture to chase missing picks and correct bad ones.
   */
  revealAll?: boolean;
}

/**
 * How a player's rebuy position reads, which is tier-specific.
 *
 * The $80 tier has a countable allowance; the $20 tier has a window instead, so
 * a number would be meaningless there and "unlimited" would be misleading once
 * the window closes.
 */
function rebuyLabelFor(
  tier: EntryTier,
  includedRemaining: number,
  currentWeek: number,
  config: SeasonConfig,
): string {
  const tc = tierConfig(config, tier);

  if (tc.includedRebuys > 0) {
    if (currentWeek > tc.includedRebuyThroughWeek) {
      return `None — expired after Week ${tc.includedRebuyThroughWeek}`;
    }
    return `${includedRemaining} of ${tc.includedRebuys} left`;
  }

  const lastWeek = tc.paidRebuyRules.reduce((max, r) => Math.max(max, r.toWeek), 0);
  if (lastWeek === 0) return "None";
  return currentWeek > lastWeek
    ? `None — closed after Week ${lastWeek}`
    : `Available through Week ${lastWeek}`;
}

export async function loadStandings(
  seasonId: string,
  currentWeek: number,
  config: SeasonConfig,
  options: StandingsOptions = {},
): Promise<StandingRow[]> {
  const now = options.now ?? new Date();
  const revealAll = options.revealAll ?? false;
  const rows = await db
    .select({
      entryId: entries.id,
      firstName: users.firstName,
      lastName: users.lastName,
      tier: entries.tier,
      status: entries.status,
      requiredPicks: entries.requiredPicks,
      includedRebuysRemaining: entries.includedRebuysRemaining,
      eliminatedAtWeek: entries.eliminatedAtWeek,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(eq(entries.seasonId, seasonId))
    .orderBy(asc(users.lastName), asc(users.firstName));

  // Kickoff comes from the game, not the pick's lock time — the reveal is tied
  // to the game starting, which is a different instant.
  const allPicks = await db
    .select({
      entryId: picks.entryId,
      teamId: picks.teamId,
      outcome: picks.outcome,
      source: picks.source,
      week: weeks.weekNumber,
      kickoff: games.kickoff,
    })
    .from(picks)
    .innerJoin(weeks, eq(weeks.id, picks.weekId))
    .innerJoin(games, eq(games.id, picks.gameId))
    .where(eq(weeks.seasonId, seasonId));

  return rows.map((row) => {
    const mine = allPicks.filter((p) => p.entryId === row.entryId);
    const visible = (p: (typeof mine)[number]) =>
      revealAll || now.getTime() >= p.kickoff.getTime();
    const started = mine.filter(visible);

    const thisWeek = mine.filter((p) => p.week === currentWeek);
    const thisWeekVisible = thisWeek.filter(visible);
    // Deliberately NOT `visible`: this flag means "the league cannot see this
    // yet", which stays true in the admin view. It is how the commissioner
    // knows a pick they are looking at has not gone public.
    const thisWeekStarted = thisWeek.filter((p) => now.getTime() >= p.kickoff.getTime());

    return {
      entryId: row.entryId,
      name: `${row.firstName} ${row.lastName}`,
      tier: row.tier,
      tierLabel: tierConfig(config, row.tier).label,
      status: row.status,
      requiredPicks: row.requiredPicks,
      includedRebuysRemaining: row.includedRebuysRemaining,
      rebuyLabel: rebuyLabelFor(row.tier, row.includedRebuysRemaining, currentWeek, config),
      eliminatedAtWeek: row.eliminatedAtWeek,
      history: started
        .sort((a, b) => a.week - b.week)
        .map((p) => ({ week: p.week, teamId: p.teamId, outcome: p.outcome, source: p.source })),
      usedTeamCount: mine.length,
      currentPick: thisWeekVisible.map((p) => p.teamId).join(", ") || null,
      // A pick exists but its game has not started: say so, rather than leaving
      // it blank and indistinguishable from having made no pick at all.
      currentPickHidden: thisWeek.length > 0 && thisWeekStarted.length === 0,
    };
  });
}

/** How many teams a player has left, useful late in a season. */
export function teamsRemaining(row: StandingRow, totalTeams = 32): number {
  return totalTeams - row.usedTeamCount;
}
