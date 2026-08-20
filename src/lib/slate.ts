/**
 * The week's slate: games, teams, lock times, and the league line.
 *
 * Assembles exactly what the pick screen and the rule engine need. All lock
 * times are computed server-side from stored data — the browser is never
 * consulted about whether a pick is still legal.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { games, oddsSnapshots, teams, weeks } from "@/db/schema";
import { lockTimeFor } from "@/rules/locks";
import type { SeasonConfig } from "@/rules/config";
import type { TeamDisplay } from "@/app/team-badge";

export interface SlateGame {
  id: string;
  kickoff: Date;
  lockAt: Date;
  status: string;
  away: TeamDisplay;
  home: TeamDisplay;
  awayScore: number | null;
  homeScore: number | null;
  /** The locked league line, if the commissioner has locked this week (D10). */
  favoriteTeamId: string | null;
  spread: number | null;
  lineIsLocked: boolean;
  /** When this line was captured from the provider. Nothing here is live. */
  lineCapturedAt: Date | null;
  lineProvider: string | null;
}

export interface Slate {
  weekId: string;
  weekNumber: number;
  startsAt: Date | null;
  sundayDeadlineAt: Date | null;
  linesLockedAt: Date | null;
  games: SlateGame[];
}

export async function loadSlate(
  seasonId: string,
  weekNumber: number,
  config: SeasonConfig,
): Promise<Slate | null> {
  const [week] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);

  if (!week) return null;

  const awayTeams = alias("away");
  const homeTeams = alias("home");
  void awayTeams;
  void homeTeams;

  const rows = await db
    .select()
    .from(games)
    .where(eq(games.weekId, week.id))
    .orderBy(asc(games.kickoff));

  const allTeams = await db.select().from(teams);
  const teamById = new Map(allTeams.map((t) => [t.id, t]));

  /*
   * Two different things share this field, and the distinction matters.
   *
   * A LOCKED league line is authoritative: default picks rank by it, forever,
   * and it must never change once locked (D10).
   *
   * Before the commissioner locks, there is no league line — only candidate
   * snapshots from the last sync. Showing the most recent candidate is useful to
   * a player deciding a pick, but it is explicitly marked unlocked so nobody
   * mistakes it for the number the league will actually run on.
   */
  const allLines = await db.select().from(oddsSnapshots).orderBy(asc(oddsSnapshots.capturedAt));
  const lineByGame = new Map<string, (typeof allLines)[number]>();
  for (const line of allLines) {
    const existing = lineByGame.get(line.gameId);
    // A locked line always wins. Otherwise the newest candidate.
    if (!existing || line.isLeagueLine || (!existing.isLeagueLine && line.capturedAt >= existing.capturedAt)) {
      if (existing?.isLeagueLine && !line.isLeagueLine) continue;
      lineByGame.set(line.gameId, line);
    }
  }

  const deadline = week.sundayDeadlineAt;

  const slateGames: SlateGame[] = rows.map((game) => {
    const line = lineByGame.get(game.id);
    return {
      id: game.id,
      kickoff: game.kickoff,
      // Falls back to kickoff-based locking if the deadline has not been
      // computed yet, so a pick can never be accepted after kickoff.
      lockAt: deadline
        ? lockTimeFor(game.kickoff, deadline, config)
        : new Date(game.kickoff.getTime() - config.earlyGameLockLeadMinutes * 60_000),
      status: game.status,
      away: display(teamById.get(game.awayTeamId), game.awayTeamId),
      home: display(teamById.get(game.homeTeamId), game.homeTeamId),
      awayScore: game.awayScore,
      homeScore: game.homeScore,
      favoriteTeamId: line?.favoriteTeamId ?? null,
      spread: line?.spread ? Number(line.spread) : null,
      lineIsLocked: Boolean(line?.isLeagueLine),
      lineCapturedAt: line?.capturedAt ?? null,
      lineProvider: line?.provider ?? null,
    };
  });

  return {
    weekId: week.id,
    weekNumber: week.weekNumber,
    startsAt: week.startsAt,
    sundayDeadlineAt: week.sundayDeadlineAt,
    linesLockedAt: week.linesLockedAt,
    games: slateGames,
  };
}

type TeamRow = typeof teams.$inferSelect;

function display(team: TeamRow | undefined, fallbackId: string): TeamDisplay {
  return {
    id: team?.id ?? fallbackId,
    city: team?.city ?? "",
    name: team?.name ?? fallbackId,
    colorPrimary: team?.colorPrimary ?? "#555555",
    colorSecondary: team?.colorSecondary ?? "#ffffff",
    logoUrl: team?.logoUrl ?? null,
  };
}

function alias(_name: string): null {
  return null;
}

/** Format an instant in league-local time for display. */
export function inLeagueTime(date: Date, config: SeasonConfig, opts?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...opts,
  }).format(date);
}

/** Week numbers that have a schedule loaded, for the week picker. */
export async function loadedWeeks(seasonId: string): Promise<number[]> {
  const rows = await db
    .select({ weekNumber: weeks.weekNumber })
    .from(weeks)
    .where(eq(weeks.seasonId, seasonId))
    .orderBy(asc(weeks.weekNumber));
  return rows.map((r) => r.weekNumber);
}

/** "PHI -3.5" style label. Null when no line was captured at all. */
export function lineLabel(game: SlateGame): string | null {
  if (game.spread === null) return null;
  if (!game.favoriteTeamId || game.spread === 0) return "Pick'em";
  return `${game.favoriteTeamId} -${game.spread}`;
}
