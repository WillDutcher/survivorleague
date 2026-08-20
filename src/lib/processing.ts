/**
 * Weekly processing: default picks, then results.
 *
 * Both operations are IDEMPOTENT. Running either twice must not create duplicate
 * picks, duplicate rebuy charges, or duplicate elimination events. That property
 * is what makes the scheduled jobs safe to retry, and it is enforced three ways:
 * a `job_runs` key, unique constraints in Postgres, and per-entry guards that
 * skip anything already resolved.
 *
 * All league decisions come from the pure rule engine in `src/rules`. This module
 * assembles inputs and persists outcomes; it never decides anything itself.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  adminExceptions,
  auditEvents,
  entries,
  games,
  jobRuns,
  oddsSnapshots,
  picks,
  rebuys,
  weeks,
} from "@/db/schema";
import type { SeasonConfig } from "@/rules/config";
import { defaultPicksFor, DEFAULT_PICK_RULE_VERSION } from "@/rules/defaults";
import { rebuyOptionsFor, requiredPicksAfterRebuy } from "@/rules/rebuys";
import { outcomeFor, resolveWeek } from "@/rules/results";
import { lockTimeFor } from "@/rules/locks";
import type { EntryState, Game, LeagueLine, PickOutcome } from "@/rules/types";

export interface ProcessReport {
  ran: boolean;
  skippedReason?: string;
  defaultsAssigned: number;
  entriesProcessed: number;
  survived: number;
  eliminated: number;
  rebuysOffered: number;
  pending: number;
  exceptions: string[];
}

const emptyReport = (): ProcessReport => ({
  ran: true,
  defaultsAssigned: 0,
  entriesProcessed: 0,
  survived: 0,
  eliminated: 0,
  rebuysOffered: 0,
  pending: 0,
  exceptions: [],
});

/**
 * Claim a run key. Returns false if this exact unit of work already ran.
 * unique(run_key) means two concurrent triggers cannot both proceed.
 */
async function claimRun(runKey: string, jobName: string): Promise<boolean> {
  try {
    await db.insert(jobRuns).values({ runKey, jobName });
    return true;
  } catch {
    return false;
  }
}

async function completeRun(runKey: string, result: unknown): Promise<void> {
  await db
    .update(jobRuns)
    .set({ completedAt: new Date(), result: result as object })
    .where(eq(jobRuns.runKey, runKey));
}

interface WeekContext {
  weekId: string;
  weekNumber: number;
  sundayDeadlineAt: Date | null;
  weekGames: Game[];
  lines: LeagueLine[];
  linesLocked: boolean;
  lockAtByGameId: Map<string, Date>;
  gameById: Map<string, Game>;
}

async function loadWeekContext(
  seasonId: string,
  weekNumber: number,
  config: SeasonConfig,
): Promise<WeekContext | null> {
  const [week] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);
  if (!week) return null;

  const rows = await db.select().from(games).where(eq(games.weekId, week.id));
  const weekGames: Game[] = rows.map((g) => ({
    id: g.id,
    week: weekNumber,
    awayTeamId: g.awayTeamId,
    homeTeamId: g.homeTeamId,
    kickoff: g.kickoff,
    status: g.status,
    awayScore: g.awayScore,
    homeScore: g.homeScore,
  }));

  const snapshots = rows.length
    ? await db
        .select()
        .from(oddsSnapshots)
        .where(
          and(
            eq(oddsSnapshots.isLeagueLine, true),
            inArray(
              oddsSnapshots.gameId,
              rows.map((g) => g.id),
            ),
          ),
        )
    : [];

  const lines: LeagueLine[] = snapshots.map((s) => ({
    gameId: s.gameId,
    favoriteTeamId: s.favoriteTeamId,
    spread: s.spread ? Number(s.spread) : 0,
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

  return {
    weekId: week.id,
    weekNumber,
    sundayDeadlineAt: week.sundayDeadlineAt,
    weekGames,
    lines,
    linesLocked: Boolean(week.linesLockedAt),
    lockAtByGameId,
    gameById: new Map(weekGames.map((g) => [g.id, g])),
  };
}

async function entryStateFor(entryId: string, seasonId: string): Promise<EntryState | null> {
  const [entry] = await db.select().from(entries).where(eq(entries.id, entryId)).limit(1);
  if (!entry) return null;

  const committed = await db
    .select({ teamId: picks.teamId })
    .from(picks)
    .innerJoin(weeks, eq(weeks.id, picks.weekId))
    .where(and(eq(picks.entryId, entryId), eq(weeks.seasonId, seasonId)));

  return {
    id: entry.id,
    tier: entry.tier,
    status: entry.status,
    committedTeamIds: committed.map((c) => c.teamId),
    requiredPicks: entry.requiredPicks,
    includedRebuysRemaining: entry.includedRebuysRemaining,
  };
}

// ---------------------------------------------------------------- default picks

/**
 * Assign default picks to active entries that are short of their requirement.
 *
 * Safe to run late. The inputs are the Thursday-locked line snapshot and the
 * entry's committed teams, both frozen before the deadline, so the result
 * computed at 12:59 and the result computed hours later are identical. Running
 * late is an embarrassment, never a corruption.
 *
 * Refuses to run at all without locked league lines: inventing a line to pick
 * from would be exactly the silent guess the brief forbids.
 */
export async function assignDefaultPicks(
  seasonId: string,
  weekNumber: number,
  config: SeasonConfig,
  now: Date = new Date(),
): Promise<ProcessReport> {
  const report = emptyReport();
  const context = await loadWeekContext(seasonId, weekNumber, config);

  if (!context) {
    return { ...report, ran: false, skippedReason: `Week ${weekNumber} has not been loaded.` };
  }
  if (!context.linesLocked) {
    return {
      ...report,
      ran: false,
      skippedReason:
        "League lines are not locked for this week. Lock them first — default picks rank by the league line and must never be assigned from an unlocked or invented one.",
    };
  }

  /*
   * Never assign a default before the deadline has actually passed.
   *
   * The scheduler is UTC and the league runs on Eastern, so the Sunday trigger
   * is scheduled at both offsets to survive DST. During EST the earlier of the
   * two fires an hour BEFORE 12:55, and assigning then would take an hour of
   * pick time away from players who were still deciding.
   *
   * Enforcing it here rather than in the schedule means no cron mistake, manual
   * click, or timezone change can ever assign a default early.
   */
  if (context.sundayDeadlineAt && now.getTime() < context.sundayDeadlineAt.getTime()) {
    return {
      ...report,
      ran: false,
      skippedReason: `The deadline has not passed yet (${context.sundayDeadlineAt.toISOString()}). Default picks are only assigned once players are out of time.`,
    };
  }

  const active = await db
    .select()
    .from(entries)
    .where(and(eq(entries.seasonId, seasonId), eq(entries.status, "active")));

  for (const entry of active) {
    const existing = await db
      .select({ id: picks.id })
      .from(picks)
      .where(and(eq(picks.entryId, entry.id), eq(picks.weekId, context.weekId)));

    const shortfall = entry.requiredPicks - existing.length;
    if (shortfall <= 0) continue;

    const state = await entryStateFor(entry.id, seasonId);
    if (!state) continue;

    // Only games still unlocked are eligible: a default must never be assigned
    // into a game that has already kicked off.
    const eligibleGames = context.weekGames.filter((g) => {
      const lockAt = context.lockAtByGameId.get(g.id);
      return lockAt ? now.getTime() < lockAt.getTime() : false;
    });

    const result = defaultPicksFor(
      { ...state, requiredPicks: shortfall },
      eligibleGames.length > 0 ? eligibleGames : context.weekGames,
      context.lines,
      weekNumber,
      config,
      { currentWeekTeamIds: [], reservedInWeek: undefined, now },
    );

    if (result.shortfall) {
      const message = `${entry.id} could not be assigned ${shortfall} default pick(s): not enough legal teams remain.`;
      report.exceptions.push(message);
      await db.insert(adminExceptions).values({
        seasonId,
        kind: "shortfall",
        severity: "error",
        message,
        context: { entryId: entry.id, weekNumber, needed: shortfall },
      });
    }

    let slot = existing.length;
    for (const assignment of result.assignments) {
      slot += 1;
      const lockAt = context.lockAtByGameId.get(assignment.gameId);
      if (!lockAt) continue;

      try {
        await db.insert(picks).values({
          entryId: entry.id,
          weekId: context.weekId,
          slot,
          teamId: assignment.teamId,
          gameId: assignment.gameId,
          source: "default",
          lockAt,
          rationale: {
            reason: assignment.rationale,
            lineValue: assignment.lineValue,
            ruleVersion: result.ruleVersion,
            candidatesConsidered: result.candidatesConsidered.map((c) => ({
              teamId: c.teamId,
              lineValue: c.lineValue,
              isHome: c.isHome,
            })),
            assignedAt: now.toISOString(),
          },
        });
        report.defaultsAssigned += 1;

        await db.insert(auditEvents).values({
          action: "pick.default_assigned",
          entityType: "entry",
          entityId: entry.id,
          after: { teamId: assignment.teamId, weekNumber, ruleVersion: DEFAULT_PICK_RULE_VERSION },
          reason: assignment.rationale,
        });
      } catch {
        // unique(entry_id, team_id) — already used. Skip and let the shortfall
        // surface rather than crashing the whole run for one entry.
        slot -= 1;
      }
    }
  }

  return report;
}

// ---------------------------------------------------------------- results

/**
 * Grade a week and advance every entry.
 *
 * Assigns any missing default picks first, so nobody is eliminated merely for
 * missing a deadline. Then, per entry, the rule engine decides survival and the
 * next week's requirement, and rebuy eligibility decides elimination.
 *
 * An entry with a game not yet final is left alone entirely — an unfinished or
 * postponed game must never advance or eliminate anyone.
 */
export async function processWeekResults(
  seasonId: string,
  weekNumber: number,
  config: SeasonConfig,
  now: Date = new Date(),
): Promise<ProcessReport> {
  const runKey = `results:${seasonId}:week-${weekNumber}`;
  const context = await loadWeekContext(seasonId, weekNumber, config);

  if (!context) {
    return {
      ...emptyReport(),
      ran: false,
      skippedReason: `Week ${weekNumber} has not been loaded.`,
    };
  }

  const report = emptyReport();

  // Fill any gaps first. This is why a missed cron fire is recoverable.
  const defaults = await assignDefaultPicks(seasonId, weekNumber, config, now);
  report.defaultsAssigned = defaults.defaultsAssigned;
  report.exceptions.push(...defaults.exceptions);
  if (!defaults.ran && defaults.skippedReason) report.exceptions.push(defaults.skippedReason);

  const claimed = await claimRun(`${runKey}:${now.toISOString().slice(0, 13)}`, "process-results");
  void claimed; // hourly key: re-running later is allowed, duplicates are guarded per entry

  const candidates = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.seasonId, seasonId),
        inArray(entries.status, ["active", "rebuy_pending"]),
      ),
    );

  for (const entry of candidates) {
    const entryPicks = await db
      .select()
      .from(picks)
      .where(and(eq(picks.entryId, entry.id), eq(picks.weekId, context.weekId)));

    if (entryPicks.length === 0) continue;

    // Already graded — nothing to do. This is what makes re-runs harmless.
    if (entryPicks.every((p) => p.outcome !== "pending")) continue;

    const outcomes: PickOutcome[] = entryPicks.map((pick) => {
      const game = context.gameById.get(pick.gameId);
      if (!game) return "pending";
      return outcomeFor(
        pick.teamId,
        game.homeTeamId,
        game.awayTeamId,
        game.homeScore,
        game.awayScore,
        game.status === "final",
      );
    });

    const resolution = resolveWeek(outcomes, weekNumber, config);

    if (resolution.verdict === "pending") {
      report.pending += 1;
      continue;
    }

    report.entriesProcessed += 1;

    await db.transaction(async (tx) => {
      for (let i = 0; i < entryPicks.length; i += 1) {
        await tx
          .update(picks)
          .set({ outcome: outcomes[i] as PickOutcome })
          .where(eq(picks.id, entryPicks[i]!.id));
      }

      if (resolution.verdict === "survived") {
        await tx
          .update(entries)
          .set({ requiredPicks: resolution.nextRequiredPicks, status: "active" })
          .where(eq(entries.id, entry.id));

        await tx.insert(auditEvents).values({
          action: "results.survived",
          entityType: "entry",
          entityId: entry.id,
          after: { weekNumber, nextRequiredPicks: resolution.nextRequiredPicks },
          reason: resolution.reason,
        });
      } else {
        const state = await entryStateFor(entry.id, seasonId);
        const eligibility = state
          ? rebuyOptionsFor(state, weekNumber, config)
          : { offers: [], ineligibleReason: "Entry state unavailable." };

        if (eligibility.offers.length > 0) {
          const offer = eligibility.offers[0]!;
          try {
            await tx.insert(rebuys).values({
              entryId: entry.id,
              lossWeekNumber: weekNumber,
              kind: offer.kind,
              priceCents: offer.priceCents,
              status: offer.kind === "included" ? "offered" : "awaiting_payment",
            });
          } catch {
            // unique(entry_id, loss_week_number) — a retry must never double-charge.
          }

          await tx
            .update(entries)
            .set({ status: "rebuy_pending", requiredPicks: requiredPicksAfterRebuy(config, entry.requiredPicks) })
            .where(eq(entries.id, entry.id));

          await tx.insert(auditEvents).values({
            action: "results.rebuy_offered",
            entityType: "entry",
            entityId: entry.id,
            after: { weekNumber, kind: offer.kind, priceCents: offer.priceCents },
            reason: resolution.reason,
          });
        } else {
          await tx
            .update(entries)
            .set({ status: "eliminated", eliminatedAtWeek: weekNumber })
            .where(eq(entries.id, entry.id));

          await tx.insert(auditEvents).values({
            action: "results.eliminated",
            entityType: "entry",
            entityId: entry.id,
            after: { weekNumber },
            reason: `${resolution.reason} ${eligibility.ineligibleReason ?? ""}`.trim(),
          });
        }
      }
    });

    if (resolution.verdict === "survived") report.survived += 1;
    else {
      const [updated] = await db.select().from(entries).where(eq(entries.id, entry.id)).limit(1);
      if (updated?.status === "eliminated") report.eliminated += 1;
      else report.rebuysOffered += 1;
    }
  }

  if (report.pending === 0) {
    await db.update(weeks).set({ resultsProcessedAt: now }).where(eq(weeks.id, context.weekId));
  }

  await completeRun(`${runKey}:${now.toISOString().slice(0, 13)}`, report);
  return report;
}
