/**
 * Provider synchronization.
 *
 * Pulls NFL teams, schedule, scores and lines from ESPN into local tables. The
 * league never reads the provider live: everything a rule needs is persisted, so
 * a provider outage delays a refresh rather than stalling a week.
 *
 * Every sync is idempotent. Re-running updates in place and never duplicates,
 * which is what makes the scheduled jobs safe to retry (PROJECT_BRIEF).
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { games, oddsSnapshots, picks, teams, weeks } from "@/db/schema";
import { raiseException } from "@/lib/exceptions";
import {
  fetchTeams,
  fetchWeek,
  parseLines,
  parseScoreboard,
  parseTeams,
  type EspnLine,
  type EspnTeam,
  type ParsedWeek,
  type SeasonType,
  SEASON_TYPE,
} from "@/integrations/espn";
import { lockTimeFor, sundayDeadlineFor } from "@/rules/locks";
import type { SeasonConfig } from "@/rules/config";
import { weekStartsAt } from "@/rules/locks";

export interface SyncResult {
  teamsUpserted?: number;
  gamesUpserted?: number;
  linesCaptured?: number;
  exceptions: string[];
}

/**
 * Teams, including colours and logo URLs.
 *
 * Logo URLs are stored, not the images. We hotlink rather than mirror (D31): the
 * provider's CDN serves its own artwork, and we never make a copy.
 */
export async function syncTeams(source?: EspnTeam[]): Promise<SyncResult> {
  // Injectable so the database path can be exercised from captured fixtures
  // offline, and so tests never depend on a live third party.
  const fetched = source ?? (await fetchTeams());
  let count = 0;

  for (const team of fetched) {
    const logoUrl = `https://a.espncdn.com/i/teamlogos/nfl/500/${team.abbreviation.toLowerCase()}.png`;
    const logoUrlDark = `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${team.abbreviation.toLowerCase()}.png`;

    await db
      .insert(teams)
      .values({
        id: team.abbreviation,
        providerId: team.providerId,
        city: team.city,
        name: team.name,
        conference: team.conference,
        division: team.division,
        colorPrimary: team.colorPrimary,
        colorSecondary: team.colorSecondary,
        logoUrl,
        logoUrlDark,
      })
      .onConflictDoUpdate({
        target: teams.id,
        set: {
          providerId: team.providerId,
          city: team.city,
          name: team.name,
          colorPrimary: team.colorPrimary,
          colorSecondary: team.colorSecondary,
          logoUrl,
          logoUrlDark,
        },
      });
    count += 1;
  }

  return { teamsUpserted: count, exceptions: [] };
}

/**
 * One week's schedule, scores, and candidate lines.
 *
 * `seasonType` defaults to the REGULAR season. Preseason must be asked for
 * explicitly and belongs to a season row that says so — syncing exhibition games
 * into a real season would be silent and catastrophic (D29, D32).
 */
export async function syncWeek(
  seasonId: string,
  seasonYear: number,
  weekNumber: number,
  config: SeasonConfig,
  source?: ParsedWeek & { lines: EspnLine[] },
  seasonType: SeasonType = SEASON_TYPE.regular,
  now: Date = new Date(),
): Promise<SyncResult> {
  const parsed = source ?? (await fetchWeek(seasonYear, weekNumber, seasonType));
  const exceptions: string[] = [];

  for (const unknown of parsed.unknownStatuses) {
    exceptions.push(`Unrecognized game status "${unknown}" — not synced, needs review.`);
  }

  // Ensure the week row exists before games can reference it.
  const [weekRow] = await db
    .insert(weeks)
    .values({ seasonId, weekNumber })
    .onConflictDoUpdate({
      target: [weeks.seasonId, weeks.weekNumber],
      set: { seasonId },
    })
    .returning({ id: weeks.id });

  const weekId = weekRow?.id;
  if (!weekId) throw new Error(`Could not create or find week ${weekNumber}.`);

  let gamesUpserted = 0;
  const gameIdByProviderId = new Map<string, string>();

  for (const game of parsed.games) {
    const [row] = await db
      .insert(games)
      .values({
        weekId,
        providerGameId: game.providerGameId,
        awayTeamId: game.awayAbbr,
        homeTeamId: game.homeAbbr,
        kickoff: game.kickoff,
        status: game.status,
        awayScore: game.awayScore,
        homeScore: game.homeScore,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: games.providerGameId,
        set: {
          kickoff: game.kickoff,
          status: game.status,
          awayScore: game.awayScore,
          homeScore: game.homeScore,
          syncedAt: new Date(),
        },
      })
      .returning({ id: games.id });

    if (row?.id) gameIdByProviderId.set(game.providerGameId, row.id);
    gamesUpserted += 1;
  }

  // The week starts at its earliest kickoff, whatever day that is (D19a).
  // 2026 Week 1 opens on a Wednesday.
  const start = weekStartsAt(parsed.games.map((g) => g.kickoff));
  const deadline = start ? sundayDeadlineAfter(start, config) : null;

  await db
    .update(weeks)
    .set({
      startsAt: start,
      ...(deadline ? { sundayDeadlineAt: deadline } : {}),
    })
    .where(eq(weeks.id, weekId));

  // Flex scheduling moves kickoffs. A pick stores its lock time at the moment it
  // was made, so a game moved EARLIER would leave a pick still editable after
  // that game had started. Recompute lock times for picks in this week whose
  // game has not yet locked, and never move a lock later than it already was.
  const relocked = await relockPicksFor(weekId, deadline, config, now);

  const linesCaptured = await captureLines(parsed.lines, gameIdByProviderId);

  // Deduped: a sync that runs every day must not stack a fresh copy of the
  // same unmatched game on top of yesterday's.
  for (const exception of exceptions) {
    await raiseException({
      seasonId,
      kind: "sync_conflict",
      message: exception,
      context: { weekNumber },
    });
  }

  if (relocked > 0) {
    exceptions.push(
      `${relocked} pick(s) had their lock time moved because a game was rescheduled.`,
    );
  }

  return { gamesUpserted, linesCaptured, exceptions };
}

/**
 * Recompute lock times after a reschedule.
 *
 * Only picks that have not already locked are touched: a locked pick is history
 * and must never be reopened. And a lock is only ever moved EARLIER — if a game
 * slides later, the player already committed under the earlier deadline and
 * giving them extra time would be an advantage nobody else got.
 */
async function relockPicksFor(
  weekId: string,
  deadline: Date | null,
  config: SeasonConfig,
  now: Date,
): Promise<number> {
  const weekGames = await db
    .select({ id: games.id, kickoff: games.kickoff })
    .from(games)
    .where(eq(games.weekId, weekId));
  if (weekGames.length === 0) return 0;

  const weekPicks = await db
    .select({ id: picks.id, gameId: picks.gameId, lockAt: picks.lockAt })
    .from(picks)
    .where(eq(picks.weekId, weekId));

  const kickoffById = new Map(weekGames.map((g) => [g.id, g.kickoff]));
  let changed = 0;

  for (const pick of weekPicks) {
    // Already locked: leave it alone. That decision is final.
    if (now.getTime() >= pick.lockAt.getTime()) continue;

    const kickoff = kickoffById.get(pick.gameId);
    if (!kickoff) continue;

    const shouldLockAt = deadline
      ? lockTimeFor(kickoff, deadline, config)
      : new Date(kickoff.getTime() - config.earlyGameLockLeadMinutes * 60_000);

    // Only ever tighten.
    if (shouldLockAt.getTime() >= pick.lockAt.getTime()) continue;

    await db.update(picks).set({ lockAt: shouldLockAt }).where(eq(picks.id, pick.id));
    changed += 1;
  }

  return changed;
}

/**
 * Store candidate lines. These are NOT league lines until the commissioner locks
 * them (D10) — `isLeagueLine` stays false here, and league decisions only ever
 * join to locked snapshots.
 */
async function captureLines(
  lines: readonly EspnLine[],
  gameIdByProviderId: ReadonlyMap<string, string>,
): Promise<number> {
  let captured = 0;
  const capturedAt = new Date();

  for (const line of lines) {
    const gameId = gameIdByProviderId.get(line.providerGameId);
    if (!gameId) continue;

    await db.insert(oddsSnapshots).values({
      gameId,
      provider: line.provider,
      capturedAt,
      favoriteTeamId: line.favoriteAbbr,
      spread: String(line.spread),
      isLeagueLine: false,
    });
    captured += 1;
  }

  return captured;
}

/**
 * The Sunday 12:55 ET deadline for the week containing `weekStart`.
 * Derived from the schedule rather than assumed, then stored on the week row so
 * it is inspectable and commissioner-overridable.
 */
function sundayDeadlineAfter(weekStart: Date, config: SeasonConfig): Date {
  // Walk forward from the week's first kickoff to the next Sunday in league time.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(weekStart);

  const field = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = field("weekday");
  const daysUntilSunday = { Sun: 0, Mon: 6, Tue: 5, Wed: 4, Thu: 3, Fri: 2, Sat: 1 }[weekday] ?? 0;

  const sunday = new Date(weekStart.getTime() + daysUntilSunday * 86_400_000);
  const sundayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(sunday);

  const get = (type: string) => Number(sundayParts.find((p) => p.type === type)?.value ?? "0");
  return sundayDeadlineFor(get("year"), get("month"), get("day"), config);
}

/** Mark a week's captured lines as the league lines, freezing them forever (D10). */
export async function lockLeagueLines(
  weekId: string,
  userId: string,
): Promise<{ locked: number; missing: string[] }> {
  const weekGames = await db
    .select({ id: games.id, away: games.awayTeamId, home: games.homeTeamId })
    .from(games)
    .where(eq(games.weekId, weekId));

  const missing: string[] = [];
  let locked = 0;

  for (const game of weekGames) {
    const [latest] = await db
      .select()
      .from(oddsSnapshots)
      .where(and(eq(oddsSnapshots.gameId, game.id), eq(oddsSnapshots.isLeagueLine, false)))
      .orderBy(oddsSnapshots.capturedAt)
      .limit(1);

    if (!latest) {
      // Never invent a line. Raise it for the commissioner instead (D10).
      missing.push(`${game.away} at ${game.home}`);
      continue;
    }

    await db
      .update(oddsSnapshots)
      .set({ isLeagueLine: true })
      .where(eq(oddsSnapshots.id, latest.id));
    locked += 1;
  }

  await db.update(weeks).set({ linesLockedAt: new Date(), linesLockedByUserId: userId }).where(eq(weeks.id, weekId));

  return { locked, missing };
}

/** Build a syncWeek payload from a raw captured scoreboard document. */
export function payloadFromScoreboard(document: unknown): ParsedWeek & { lines: EspnLine[] } {
  return { ...parseScoreboard(document), lines: parseLines(document) };
}

/** Build a syncTeams payload from a raw captured teams document. */
export function payloadFromTeams(document: unknown): EspnTeam[] {
  return parseTeams(document);
}
