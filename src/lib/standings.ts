/**
 * League standings.
 *
 * Fairness rule from the brief: another player's CURRENT pick is hidden until it
 * locks. Past picks are open history — that is the point of a survivor pool.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { entries, picks, users, weeks } from "@/db/schema";

export interface StandingRow {
  entryId: string;
  name: string;
  tier: string;
  status: string;
  requiredPicks: number;
  includedRebuysRemaining: number;
  eliminatedAtWeek: number | null;
  /** Locked picks only, oldest first. */
  history: Array<{ week: number; teamId: string; outcome: string; source: string }>;
  usedTeamCount: number;
  /** True when this player has a pick in the current week that is not yet locked. */
  hasHiddenPick: boolean;
}

export async function loadStandings(
  seasonId: string,
  currentWeek: number,
  now: Date = new Date(),
): Promise<StandingRow[]> {
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

  const allPicks = await db
    .select({
      entryId: picks.entryId,
      teamId: picks.teamId,
      outcome: picks.outcome,
      source: picks.source,
      lockAt: picks.lockAt,
      week: weeks.weekNumber,
    })
    .from(picks)
    .innerJoin(weeks, eq(weeks.id, picks.weekId))
    .where(eq(weeks.seasonId, seasonId));

  return rows.map((row) => {
    const mine = allPicks.filter((p) => p.entryId === row.entryId);
    const locked = mine.filter((p) => now.getTime() >= p.lockAt.getTime());
    const hidden = mine.some(
      (p) => p.week === currentWeek && now.getTime() < p.lockAt.getTime(),
    );

    return {
      entryId: row.entryId,
      name: `${row.firstName} ${row.lastName}`,
      tier: row.tier,
      status: row.status,
      requiredPicks: row.requiredPicks,
      includedRebuysRemaining: row.includedRebuysRemaining,
      eliminatedAtWeek: row.eliminatedAtWeek,
      history: locked
        .sort((a, b) => a.week - b.week)
        .map((p) => ({ week: p.week, teamId: p.teamId, outcome: p.outcome, source: p.source })),
      usedTeamCount: mine.length,
      hasHiddenPick: hidden,
    };
  });
}

/** How many teams each player has left, useful late in a season. */
export function teamsRemaining(row: StandingRow, totalTeams = 32): number {
  return totalTeams - row.usedTeamCount;
}
