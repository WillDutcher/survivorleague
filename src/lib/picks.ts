/**
 * Pick data access.
 *
 * The rules themselves live in `src/rules` as pure functions. This module only
 * assembles the plain data they need and writes back what they decide — it never
 * makes a league decision of its own.
 */

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { entries, games, picks, weeks } from "@/db/schema";
import { teamAvailability, validatePick, type TeamAvailability } from "@/rules/eligibility";
import type { EntryState, Game, WeekNumber } from "@/rules/types";
import type { SeasonConfig } from "@/rules/config";
import { lockTimeFor } from "@/rules/locks";

export interface EntryPickContext {
  entry: EntryState;
  /** team -> the week it is committed to, for precise "already used" messages. */
  committedInWeek: Map<string, WeekNumber>;
  /** Picks held for the week being viewed. */
  currentWeekPicks: Array<{ id: string; teamId: string; slot: number; lockAt: Date; locked: boolean }>;
}

/**
 * Everything needed to render and validate picks for one entry in one week.
 *
 * `committedTeamIds` deliberately spans the whole season, past and future, so a
 * team taken for Week 12 is unavailable in Week 4 and vice versa.
 */
export async function loadEntryPickContext(
  entryId: string,
  seasonId: string,
  weekNumber: WeekNumber,
  now: Date = new Date(),
): Promise<EntryPickContext | null> {
  const [entry] = await db.select().from(entries).where(eq(entries.id, entryId)).limit(1);
  if (!entry) return null;

  const rows = await db
    .select({
      id: picks.id,
      teamId: picks.teamId,
      slot: picks.slot,
      lockAt: picks.lockAt,
      weekNumber: weeks.weekNumber,
    })
    .from(picks)
    .innerJoin(weeks, eq(weeks.id, picks.weekId))
    .where(and(eq(picks.entryId, entryId), eq(weeks.seasonId, seasonId)));

  const committedInWeek = new Map<string, WeekNumber>();
  for (const row of rows) committedInWeek.set(row.teamId, row.weekNumber);

  const currentWeekPicks = rows
    .filter((r) => r.weekNumber === weekNumber)
    .map((r) => ({
      id: r.id,
      teamId: r.teamId,
      slot: r.slot,
      lockAt: r.lockAt,
      locked: now.getTime() >= r.lockAt.getTime(),
    }))
    .sort((a, b) => a.slot - b.slot);

  return {
    entry: {
      id: entry.id,
      tier: entry.tier,
      status: entry.status,
      committedTeamIds: rows.map((r) => r.teamId),
      requiredPicks: entry.requiredPicks,
      includedRebuysRemaining: entry.includedRebuysRemaining,
    },
    committedInWeek,
    currentWeekPicks,
  };
}

/** Availability for every team in the week, with a reason for each unavailable one. */
export function availabilityFor(
  context: EntryPickContext,
  weekGames: readonly Game[],
  lockAtByGameId: ReadonlyMap<string, Date>,
  now: Date,
): TeamAvailability[] {
  return teamAvailability(context.entry, weekGames, {
    currentWeekTeamIds: context.currentWeekPicks.map((p) => p.teamId),
    reservedInWeek: context.committedInWeek,
    lockAtByGameId,
    now,
    viewingWeek: weekGames[0]?.week,
  });
}

export type SubmitOutcome =
  | { ok: true; action: "added" | "removed" | "replaced"; teamId: string }
  | { ok: false; message: string };

/**
 * Add, replace, or remove a pick.
 *
 * Toggle semantics: clicking a team you already hold removes it; clicking a new
 * team adds it. When the week needs exactly one pick, a new choice replaces the
 * old one, which is what everyone expects. When a tie has pushed the requirement
 * above one and every slot is taken, the player is told to drop one first rather
 * than having the app silently guess which to discard.
 *
 * Every legality decision below comes from the rule engine, and the deadline is
 * re-checked here against the server clock — the browser is never trusted.
 */
export async function submitPick(
  entryId: string,
  seasonId: string,
  weekNumber: WeekNumber,
  teamId: string,
  config: SeasonConfig,
  now: Date = new Date(),
): Promise<SubmitOutcome> {
  const context = await loadEntryPickContext(entryId, seasonId, weekNumber, now);
  if (!context) return { ok: false, message: "Entry not found." };

  const [week] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);
  if (!week) return { ok: false, message: "That week has not been loaded yet." };

  const weekGameRows = await db.select().from(games).where(eq(games.weekId, week.id));
  const weekGames: Game[] = weekGameRows.map((g) => ({
    id: g.id,
    week: weekNumber,
    awayTeamId: g.awayTeamId,
    homeTeamId: g.homeTeamId,
    kickoff: g.kickoff,
    status: g.status,
    awayScore: g.awayScore,
    homeScore: g.homeScore,
  }));

  const lockAtByGameId = new Map<string, Date>();
  for (const game of weekGames) {
    lockAtByGameId.set(
      game.id,
      week.sundayDeadlineAt
        ? lockTimeFor(game.kickoff, week.sundayDeadlineAt, config)
        : new Date(game.kickoff.getTime() - config.earlyGameLockLeadMinutes * 60_000),
    );
  }

  const existing = context.currentWeekPicks.find((p) => p.teamId === teamId);

  // Removing a pick you already hold.
  if (existing) {
    if (existing.locked) {
      return { ok: false, message: "That pick is locked and can no longer be changed." };
    }
    await db.delete(picks).where(eq(picks.id, existing.id));
    return { ok: true, action: "removed", teamId };
  }

  const validation = validatePick(context.entry, teamId, weekGames, {
    currentWeekTeamIds: context.currentWeekPicks.map((p) => p.teamId),
    reservedInWeek: context.committedInWeek,
    lockAtByGameId,
    now,
    viewingWeek: weekNumber,
  });

  if (!validation.ok) return { ok: false, message: validation.message };

  const required = context.entry.requiredPicks;
  const unlocked = context.currentWeekPicks.filter((p) => !p.locked);
  const full = context.currentWeekPicks.length >= required;

  let action: "added" | "replaced" = "added";
  let slot = nextFreeSlot(context.currentWeekPicks.map((p) => p.slot), required);

  if (full) {
    if (required === 1) {
      const replaceable = unlocked[0];
      if (!replaceable) {
        return { ok: false, message: "Your pick is locked and can no longer be changed." };
      }
      await db.delete(picks).where(eq(picks.id, replaceable.id));
      slot = replaceable.slot;
      action = "replaced";
    } else {
      return {
        ok: false,
        message: `You already have all ${required} picks for this week. Remove one before choosing another.`,
      };
    }
  }

  const lockAt = lockAtByGameId.get(validation.gameId);
  if (!lockAt) return { ok: false, message: "Could not determine the lock time for that game." };
  if (now.getTime() >= lockAt.getTime()) {
    return { ok: false, message: "That game is past its lock time." };
  }

  try {
    await db.insert(picks).values({
      entryId,
      weekId: week.id,
      slot,
      teamId,
      gameId: validation.gameId,
      source: "player",
      lockAt,
    });
  } catch (error) {
    // unique(entry_id, team_id) is the no-reuse rule enforced by Postgres. If we
    // land here the application check was bypassed or raced; the database is the
    // backstop and its refusal is authoritative.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("picks_entry_team_unique")) {
      return { ok: false, message: "You have already used that team this season." };
    }
    throw error;
  }

  return { ok: true, action, teamId };
}

function nextFreeSlot(taken: readonly number[], required: number): number {
  const used = new Set(taken);
  for (let slot = 1; slot <= Math.max(required, taken.length + 1); slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return taken.length + 1;
}

/** Other entries' picks for a week, for the standings view once locked. */
export async function lockedPicksForWeek(seasonId: string, weekNumber: WeekNumber, now: Date) {
  const [week] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);
  if (!week) return [];

  const rows = await db
    .select({ entryId: picks.entryId, teamId: picks.teamId, lockAt: picks.lockAt })
    .from(picks)
    .where(and(eq(picks.weekId, week.id), ne(picks.source, "commissioner")));

  // Default to hiding unlocked picks so nobody can shadow another player.
  return rows.filter((r) => now.getTime() >= r.lockAt.getTime());
}
