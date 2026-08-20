/**
 * League standings.
 *
 * VISIBILITY RULE
 * A pick is hidden until IT LOCKS, and every pick for a week locks at the same
 * Sunday deadline at the latest — a Monday-night pick locks Sunday 12:55 along
 * with everything else, because lockTimeFor takes the earlier of the deadline
 * and five minutes before kickoff.
 *
 * The reason to hide a pick is to stop other people reacting to it. Once locked
 * nobody can react, so there is nothing left to protect. Holding it until
 * kickoff would also contradict the Sunday 1 PM digest, which mails the whole
 * locked slate to everyone.
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
import { entries, picks, teams, users, weeks } from "@/db/schema";
import { tierConfig, type SeasonConfig } from "@/rules/config";
import type { EntryTier } from "@/rules/types";
import type { TeamDisplay } from "@/app/team-badge";

export interface StandingPick {
  week: number;
  teamId: string;
  outcome: string;
  source: string;
  /** Colours and logo for display. Null if the team row is somehow missing. */
  team: TeamDisplay | null;
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
  /** Picks that have locked. Open history. */
  history: StandingPick[];
  usedTeamCount: number;
  /** This week's picks, once locked. Plural: a tie owes more than one. */
  currentPicks: StandingPick[];
  /** True when a pick exists for this week but has not locked yet. */
  currentPickHidden: boolean;
  /**
   * Still owes picks this week. Counts against requiredPicks, which a tie
   * raises above one — someone who owes two and has made one is still short.
   * Always false for entries that cannot pick at all.
   */
  needsPick: boolean;
  /** How many are still outstanding. */
  picksOutstanding: number;
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

  const allPicks = await db
    .select({
      entryId: picks.entryId,
      teamId: picks.teamId,
      outcome: picks.outcome,
      source: picks.source,
      week: weeks.weekNumber,
      lockAt: picks.lockAt,
    })
    .from(picks)
    .innerJoin(weeks, eq(weeks.id, picks.weekId))
    .where(eq(weeks.seasonId, seasonId));

  // One lookup for all 32, rather than a join that repeats the colours on every
  // pick row.
  const teamRows = await db
    .select({
      id: teams.id,
      city: teams.city,
      name: teams.name,
      colorPrimary: teams.colorPrimary,
      colorSecondary: teams.colorSecondary,
      logoUrl: teams.logoUrl,
    })
    .from(teams);
  const teamById = new Map<string, TeamDisplay>(teamRows.map((t) => [t.id, t]));

  const toPick = (p: (typeof allPicks)[number]): StandingPick => ({
    week: p.week,
    teamId: p.teamId,
    outcome: p.outcome,
    source: p.source,
    team: teamById.get(p.teamId) ?? null,
  });

  return rows.map((row) => {
    const mine = allPicks.filter((p) => p.entryId === row.entryId);
    const visible = (p: (typeof mine)[number]) =>
      revealAll || now.getTime() >= p.lockAt.getTime();
    const locked = mine.filter(visible);

    const thisWeek = mine.filter((p) => p.week === currentWeek);
    const thisWeekVisible = thisWeek.filter(visible);
    // Deliberately NOT `visible`: this flag means "the league cannot see this
    // yet", which stays true in the admin view. It is how the commissioner
    // knows a pick they are looking at has not gone public.
    const thisWeekLocked = thisWeek.filter((p) => now.getTime() >= p.lockAt.getTime());

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
      history: locked.sort((a, b) => a.week - b.week).map(toPick),
      usedTeamCount: mine.length,
      currentPicks: thisWeekVisible.map(toPick),
      // Counted from ALL of this week's picks, not the visible ones: whether
      // someone has picked is not a secret, only which team they took.
      needsPick: row.status === "active" && thisWeek.length < row.requiredPicks,
      picksOutstanding:
        row.status === "active" ? Math.max(0, row.requiredPicks - thisWeek.length) : 0,
      // A pick exists but its game has not started: say so, rather than leaving
      // it blank and indistinguishable from having made no pick at all.
      currentPickHidden: thisWeek.length > 0 && thisWeekLocked.length === 0,
    };
  });
}

/** How many teams a player has left, useful late in a season. */
export function teamsRemaining(row: StandingRow, totalTeams = 32): number {
  return totalTeams - row.usedTeamCount;
}
