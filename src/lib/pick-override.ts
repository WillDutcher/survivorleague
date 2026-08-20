/**
 * Commissioner pick override.
 *
 * The brief requires being able to correct a bad pick, and requires every such
 * correction to be audited. This is the one place in the app where league state
 * is changed by hand rather than by rule, so it is deliberately narrow.
 *
 * SCOPE (D44). An override is allowed right up until the week is graded — which
 * includes the window after kickoff, because the common real case is a player
 * emailing mid-Sunday to say the app took the wrong team. It is refused once
 * results have been processed: reversing a graded week would have to unwind
 * eliminations, rebuy offers and split ballots that were issued on the strength
 * of that result, and a half-unwound season is worse than a wrong pick.
 *
 * The no-reuse rule is NOT bypassed. `unique(entry_id, team_id)` is a database
 * constraint precisely so that no code path — including this one — can violate
 * it. An override onto an already-used team is refused with a clear message
 * rather than caught at the constraint.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, entries, games, picks, users, weeks } from "@/db/schema";
import { lockTimeFor } from "@/rules/locks";
import { inLeagueTime } from "@/lib/slate";
import type { SeasonConfig } from "@/rules/config";

export interface OverrideResult {
  ok: boolean;
  message: string;
}

export interface OverrideInput {
  entryId: string;
  weekNumber: number;
  /** The team to put on the pick. Must be in the game identified by gameId. */
  teamId: string;
  gameId: string;
  /** Which pick to replace when a tie owes several. 1-based. */
  slot?: number;
  reason: string;
  actorUserId: string;
}

export async function overridePick(
  seasonId: string,
  config: SeasonConfig,
  input: OverrideInput,
  now: Date = new Date(),
): Promise<OverrideResult> {
  const reason = input.reason.trim();
  // A correction with no stated reason is indistinguishable from tampering
  // when someone reads the audit log a season later.
  if (reason.length < 3) {
    return { ok: false, message: "A reason is required — it goes in the audit log." };
  }

  const [entry] = await db
    .select({ id: entries.id, userId: entries.userId, status: entries.status })
    .from(entries)
    .where(and(eq(entries.id, input.entryId), eq(entries.seasonId, seasonId)))
    .limit(1);
  if (!entry) return { ok: false, message: "That entry is not in this season." };

  const [week] = await db
    .select({
      id: weeks.id,
      resultsProcessedAt: weeks.resultsProcessedAt,
      sundayDeadlineAt: weeks.sundayDeadlineAt,
    })
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, input.weekNumber)))
    .limit(1);
  if (!week) return { ok: false, message: `Week ${input.weekNumber} is not loaded.` };

  if (week.resultsProcessedAt) {
    return {
      ok: false,
      message:
        `Week ${input.weekNumber} has already been graded. Overrides stop at grading — ` +
        `changing it now would leave eliminations and rebuy offers standing on a result ` +
        `that no longer exists.`,
    };
  }

  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, input.gameId), eq(games.weekId, week.id)))
    .limit(1);
  if (!game) return { ok: false, message: "That game is not in that week." };

  if (game.awayTeamId !== input.teamId && game.homeTeamId !== input.teamId) {
    return { ok: false, message: `${input.teamId} is not playing in that game.` };
  }

  // The no-reuse rule stands. Allow the team already on THIS pick through, so
  // that correcting the game or slot without changing the team is possible.
  const used = await db
    .select({ id: picks.id, weekId: picks.weekId })
    .from(picks)
    .where(and(eq(picks.entryId, input.entryId), eq(picks.teamId, input.teamId)));

  const slot = input.slot ?? 1;
  const [existing] = await db
    .select()
    .from(picks)
    .where(
      and(
        eq(picks.entryId, input.entryId),
        eq(picks.weekId, week.id),
        eq(picks.slot, slot),
      ),
    )
    .limit(1);

  const clash = used.find((u) => u.id !== existing?.id);
  if (clash) {
    return {
      ok: false,
      message:
        `${input.teamId} has already been used by this entry in another week. ` +
        `No-reuse is a database constraint and is not overridable — a rebuy does not ` +
        `reset it either.`,
    };
  }

  if (existing && existing.outcome !== "pending") {
    return {
      ok: false,
      message: `That pick is already graded as "${existing.outcome}" and cannot be changed here.`,
    };
  }

  // Without a Sunday deadline the early-game rule is the only constraint, so
  // fall back to it rather than refusing — a week can legitimately be all
  // standalone games (Thanksgiving, the international slate).
  const lockAt = week.sundayDeadlineAt
    ? lockTimeFor(game.kickoff, week.sundayDeadlineAt, config)
    : new Date(game.kickoff.getTime() - config.earlyGameLockLeadMinutes * 60_000);
  const after = {
    teamId: input.teamId,
    gameId: input.gameId,
    slot,
    lockAt: lockAt.toISOString(),
    kickedOff: now.getTime() >= game.kickoff.getTime(),
  };

  if (existing) {
    await db
      .update(picks)
      .set({
        teamId: input.teamId,
        gameId: input.gameId,
        // Marked as the commissioner's doing, so it is never mistaken for the
        // player's own choice or for an automatic default.
        source: "commissioner",
        lockAt,
        updatedAt: new Date(),
      })
      .where(eq(picks.id, existing.id));
  } else {
    await db.insert(picks).values({
      entryId: input.entryId,
      weekId: week.id,
      slot,
      teamId: input.teamId,
      gameId: input.gameId,
      source: "commissioner",
      lockAt,
    });
  }

  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId,
    action: existing ? "pick.override" : "pick.create",
    entityType: "pick",
    entityId: existing?.id ?? input.entryId,
    before: existing
      ? {
          teamId: existing.teamId,
          gameId: existing.gameId,
          slot: existing.slot,
          source: existing.source,
          lockAt: existing.lockAt.toISOString(),
        }
      : null,
    after,
    reason,
  });

  const [player] = await db
    .select({ firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, entry.userId))
    .limit(1);

  const who = player ? `${player.firstName} ${player.lastName}` : "that entry";
  const note = after.kickedOff ? " Note: that game has already kicked off." : "";

  return {
    ok: true,
    message: existing
      ? `${who}: week ${input.weekNumber} pick changed from ${existing.teamId} to ${input.teamId}. Logged.${note}`
      : `${who}: week ${input.weekNumber} pick set to ${input.teamId}. Logged.${note}`,
  };
}

/**
 * Everything the override form needs: who is active, what they have picked, and
 * what games are available.
 *
 * Kickoff is pre-formatted here rather than in the client component, so the
 * league's timezone rule is applied once on the server instead of falling back
 * to whatever the commissioner's browser happens to be set to.
 */
export async function loadOverrideContext(
  seasonId: string,
  weekNumber: number,
  config: SeasonConfig,
  now: Date = new Date(),
) {
  const [week] = await db
    .select({ id: weeks.id })
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);

  if (!week) return { entries: [], games: [] };

  const rows = await db
    .select({
      entryId: entries.id,
      firstName: users.firstName,
      lastName: users.lastName,
      requiredPicks: entries.requiredPicks,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(and(eq(entries.seasonId, seasonId), eq(entries.status, "active")))
    .orderBy(asc(users.lastName), asc(users.firstName));

  const made = await db
    .select({ entryId: picks.entryId, slot: picks.slot, teamId: picks.teamId, source: picks.source })
    .from(picks)
    .where(eq(picks.weekId, week.id));

  const gameRows = await db
    .select()
    .from(games)
    .where(eq(games.weekId, week.id))
    .orderBy(asc(games.kickoff));

  return {
    entries: rows.map((r) => ({
      entryId: r.entryId,
      name: `${r.firstName} ${r.lastName}`,
      requiredPicks: r.requiredPicks,
      currentPicks: made
        .filter((m) => m.entryId === r.entryId)
        .sort((a, b) => a.slot - b.slot)
        .map((m) => ({ slot: m.slot, teamId: m.teamId, source: m.source })),
    })),
    games: gameRows.map((g) => ({
      id: g.id,
      awayTeamId: g.awayTeamId,
      homeTeamId: g.homeTeamId,
      kickoff: inLeagueTime(g.kickoff, config),
      kickedOff: now.getTime() >= g.kickoff.getTime(),
    })),
  };
}
