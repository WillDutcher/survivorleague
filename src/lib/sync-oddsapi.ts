/**
 * Sync scores and lines from The Odds API into games ESPN already defined.
 *
 * ESPN owns week structure; this owns what happened and what the line was
 * (D35). Games are matched on the two team ids plus the kickoff DATE — not the
 * exact instant, because providers disagree by minutes on start times and an
 * exact-timestamp match would silently find nothing.
 *
 * Nothing here creates games. If a provider event matches no known game it is
 * reported as an exception rather than inserted, because a game with no week
 * belongs to no league rule and would sit invisible in the database.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { adminExceptions, games, oddsSnapshots, weeks } from "@/db/schema";
import {
  fetchLines,
  fetchScores,
  type OddsApiLine,
  type OddsApiScore,
} from "@/integrations/oddsapi";

export interface OddsApiSyncResult {
  scoresUpdated: number;
  linesCaptured: number;
  unmatched: number;
  exceptions: string[];
  creditsRemaining: string | null;
}

/** Calendar day in league time, for matching across providers. */
function dayKey(when: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
}

function matchKey(awayTeamId: string, homeTeamId: string, when: Date, timeZone: string): string {
  return `${awayTeamId}@${homeTeamId}:${dayKey(when, timeZone)}`;
}

interface KnownGame {
  id: string;
  weekId: string;
  awayTeamId: string;
  homeTeamId: string;
  kickoff: Date;
  status: string;
}

async function knownGames(seasonId: string): Promise<KnownGame[]> {
  const weekRows = await db.select({ id: weeks.id }).from(weeks).where(eq(weeks.seasonId, seasonId));
  if (weekRows.length === 0) return [];

  return db
    .select({
      id: games.id,
      weekId: games.weekId,
      awayTeamId: games.awayTeamId,
      homeTeamId: games.homeTeamId,
      kickoff: games.kickoff,
      status: games.status,
    })
    .from(games)
    .where(
      inArray(
        games.weekId,
        weekRows.map((w) => w.id),
      ),
    );
}

/**
 * Build the lookup twice — once on the exact day, once on the day either side.
 * A late-night kickoff lands on a different calendar day depending on the
 * timezone a provider reports in, and missing every Sunday-night game would be
 * a quiet, total failure.
 */
function buildIndex(all: KnownGame[], timeZone: string): Map<string, KnownGame> {
  const index = new Map<string, KnownGame>();
  for (const game of all) {
    const day = game.kickoff;
    for (const offsetHours of [0, -12, 12]) {
      const shifted = new Date(day.getTime() + offsetHours * 3_600_000);
      const key = matchKey(game.awayTeamId, game.homeTeamId, shifted, timeZone);
      if (!index.has(key)) index.set(key, game);
    }
  }
  return index;
}

function findGame(
  index: Map<string, KnownGame>,
  awayTeamId: string,
  homeTeamId: string,
  when: Date,
  timeZone: string,
): KnownGame | undefined {
  for (const offsetHours of [0, -12, 12]) {
    const shifted = new Date(when.getTime() + offsetHours * 3_600_000);
    const found = index.get(matchKey(awayTeamId, homeTeamId, shifted, timeZone));
    if (found) return found;
  }
  return undefined;
}

export async function syncScoresAndLines(
  seasonId: string,
  timeZone: string,
  options: { daysFrom?: number; preferredBookmaker?: string } = {},
  sources?: { scores?: OddsApiScore[]; lines?: OddsApiLine[] },
): Promise<OddsApiSyncResult> {
  const result: OddsApiSyncResult = {
    scoresUpdated: 0,
    linesCaptured: 0,
    unmatched: 0,
    exceptions: [],
    creditsRemaining: null,
  };

  const all = await knownGames(seasonId);
  if (all.length === 0) {
    result.exceptions.push(
      "No games are loaded for this season. Sync the schedule from ESPN first (`npm run sync:prod`).",
    );
    return result;
  }

  const index = buildIndex(all, timeZone);

  // ---- scores
  let scores: OddsApiScore[];
  if (sources?.scores) {
    scores = sources.scores;
  } else {
    const fetched = await fetchScores(options.daysFrom ?? 3);
    scores = fetched.scores;
    result.creditsRemaining = fetched.creditsRemaining;
    for (const p of fetched.problems) result.exceptions.push(p.message);
  }

  for (const score of scores) {
    const game = findGame(index, score.awayTeamId, score.homeTeamId, score.commenceTime, timeZone);
    if (!game) {
      result.unmatched += 1;
      continue;
    }

    // Only completed games carry scores, and only a completed game becomes
    // final. An unfinished game must never advance or eliminate anyone.
    if (!score.completed) continue;
    if (score.awayScore === null || score.homeScore === null) continue;

    await db
      .update(games)
      .set({
        status: "final",
        awayScore: score.awayScore,
        homeScore: score.homeScore,
        syncedAt: new Date(),
      })
      .where(eq(games.id, game.id));

    result.scoresUpdated += 1;
  }

  // ---- lines
  let lines: OddsApiLine[];
  if (sources?.lines) {
    lines = sources.lines;
  } else {
    const fetched = await fetchLines(options.preferredBookmaker);
    lines = fetched.lines;
    result.creditsRemaining = fetched.creditsRemaining ?? result.creditsRemaining;
    for (const p of fetched.problems) result.exceptions.push(p.message);
  }

  const capturedAt = new Date();
  for (const line of lines) {
    const game = findGame(index, line.awayTeamId, line.homeTeamId, line.commenceTime, timeZone);
    if (!game) {
      result.unmatched += 1;
      continue;
    }

    // Captured as a CANDIDATE. It does not become the league line until the
    // commissioner locks it (D10), and a locked snapshot is never overwritten.
    await db.insert(oddsSnapshots).values({
      gameId: game.id,
      provider: `The Odds API / ${line.bookmaker}`,
      capturedAt,
      favoriteTeamId: line.favoriteTeamId,
      spread: String(line.spread),
      isLeagueLine: false,
    });

    result.linesCaptured += 1;
  }

  for (const message of result.exceptions) {
    await db.insert(adminExceptions).values({
      seasonId,
      kind: "sync_conflict",
      severity: "warning",
      message,
      context: { provider: "the-odds-api" },
    });
  }

  return result;
}

/** Games still awaiting a final score, so the commissioner can see what is outstanding. */
export async function gamesAwaitingScores(seasonId: string, weekNumber: number) {
  const [week] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);
  if (!week) return [];

  const rows = await db
    .select({
      away: games.awayTeamId,
      home: games.homeTeamId,
      kickoff: games.kickoff,
      status: games.status,
    })
    .from(games)
    .where(eq(games.weekId, week.id));

  return rows.filter((g) => g.status !== "final" && g.kickoff.getTime() < Date.now());
}
