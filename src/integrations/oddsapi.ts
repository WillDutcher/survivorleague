/**
 * The Odds API — scores and point spreads.
 *
 * WHY THIS EXISTS ALONGSIDE ESPN
 * ESPN refuses requests from Vercel and from Cloudflare Workers (D34, D35), so
 * the deployed app cannot fetch from it at all. The Odds API is a keyed service
 * built for server access, so it works from anywhere.
 *
 * DIVISION OF LABOUR
 * This provider has no concept of an NFL week — it is date-based. Week structure
 * still comes from ESPN, synced occasionally from a machine ESPN will talk to,
 * because a season's week layout barely changes. What needs to happen weekly and
 * automatically is scores and lines, and that is what this covers.
 *
 * So: ESPN defines WHICH games exist and which week they belong to. The Odds API
 * fills in what happened and what the line was. Games are matched on team plus
 * kickoff date.
 *
 * IMPORTANT LIMIT
 * `daysFrom` accepts 1-3 only. Completed games older than three days cannot be
 * fetched. A Sunday slate must therefore be synced by Wednesday. The results
 * processor is idempotent and safe to run late, but the SCORES have to be
 * collected inside that window.
 */

export const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
export const NFL_SPORT_KEY = "americanfootball_nfl";

/**
 * Full team names as this provider spells them, mapped to our abbreviations.
 * ESPN's abbreviations are canonical throughout the app, so everything from here
 * is translated on the way in and never stored raw.
 */
const TEAM_BY_NAME: Record<string, string> = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
  "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN", "Washington Commanders": "WSH",
};

/**
 * Translate a provider team name. Returns null for anything unrecognised rather
 * than guessing — a wrong team here would grade the wrong pick, so an unknown
 * name must surface as an admin exception instead.
 */
export function teamIdFor(name: string): string | null {
  return TEAM_BY_NAME[name.trim()] ?? null;
}

export interface OddsApiScore {
  providerEventId: string;
  awayTeamId: string;
  homeTeamId: string;
  commenceTime: Date;
  completed: boolean;
  awayScore: number | null;
  homeScore: number | null;
}

export interface OddsApiLine {
  providerEventId: string;
  bookmaker: string;
  awayTeamId: string;
  homeTeamId: string;
  commenceTime: Date;
  /** null at pick'em or when no spread was quoted. */
  favoriteTeamId: string | null;
  /** Positive magnitude, e.g. 3.5. */
  spread: number;
}

export interface ParseProblem {
  eventId: string;
  message: string;
}

export interface ParsedScores {
  scores: OddsApiScore[];
  problems: ParseProblem[];
}

/**
 * Parse the /scores response.
 *
 * Scores arrive as an array of `{ name, score }` where name is a full team
 * name, so home and away must be resolved by matching names rather than
 * position. Position is not guaranteed and assuming it would silently swap
 * scores.
 */
export function parseScores(payload: unknown): ParsedScores {
  const events = Array.isArray(payload) ? payload : [];
  const scores: OddsApiScore[] = [];
  const problems: ParseProblem[] = [];

  for (const raw of events) {
    const event = raw as {
      id?: string;
      home_team?: string;
      away_team?: string;
      commence_time?: string;
      completed?: boolean;
      scores?: Array<{ name?: string; score?: string | number }> | null;
    };

    const eventId = String(event.id ?? "unknown");
    const homeTeamId = teamIdFor(String(event.home_team ?? ""));
    const awayTeamId = teamIdFor(String(event.away_team ?? ""));

    if (!homeTeamId || !awayTeamId) {
      problems.push({
        eventId,
        message: `Unrecognised team name: "${event.away_team}" at "${event.home_team}". Not synced.`,
      });
      continue;
    }

    const completed = Boolean(event.completed);
    let awayScore: number | null = null;
    let homeScore: number | null = null;

    if (completed && Array.isArray(event.scores)) {
      for (const entry of event.scores) {
        const teamId = teamIdFor(String(entry.name ?? ""));
        const value = Number(entry.score);
        if (teamId === null || Number.isNaN(value)) continue;
        if (teamId === homeTeamId) homeScore = value;
        if (teamId === awayTeamId) awayScore = value;
      }

      // A completed game missing a score is an exception, never a 0.
      if (homeScore === null || awayScore === null) {
        problems.push({
          eventId,
          message: `Game marked completed but scores are incomplete (${awayTeamId} ${awayScore}, ${homeTeamId} ${homeScore}). Not synced.`,
        });
        continue;
      }
    }

    scores.push({
      providerEventId: eventId,
      awayTeamId,
      homeTeamId,
      commenceTime: new Date(String(event.commence_time ?? "")),
      completed,
      // Only trust scores on a completed game. Live scores would otherwise be
      // treated as final and could eliminate someone at half time.
      awayScore: completed ? awayScore : null,
      homeScore: completed ? homeScore : null,
    });
  }

  return { scores, problems };
}

export interface ParsedLines {
  lines: OddsApiLine[];
  problems: ParseProblem[];
}

/**
 * Parse the /odds response for the spreads market.
 *
 * Every bookmaker quotes the same game, so one is chosen per event: the first
 * listed, which the provider orders consistently. Which book supplied the line
 * is recorded with the snapshot, because "what number did we use and who said
 * so" has to be answerable months later (D10).
 *
 * Spread points are signed per outcome — the favourite carries the negative
 * number. The favourite is therefore whichever outcome has a negative point,
 * not an assumption about ordering.
 */
export function parseLines(payload: unknown, preferredBookmaker?: string): ParsedLines {
  const events = Array.isArray(payload) ? payload : [];
  const lines: OddsApiLine[] = [];
  const problems: ParseProblem[] = [];

  for (const raw of events) {
    const event = raw as {
      id?: string;
      home_team?: string;
      away_team?: string;
      commence_time?: string;
      bookmakers?: Array<{
        key?: string;
        title?: string;
        markets?: Array<{
          key?: string;
          outcomes?: Array<{ name?: string; point?: number }>;
        }>;
      }>;
    };

    const eventId = String(event.id ?? "unknown");
    const homeTeamId = teamIdFor(String(event.home_team ?? ""));
    const awayTeamId = teamIdFor(String(event.away_team ?? ""));
    if (!homeTeamId || !awayTeamId) continue;

    const books = event.bookmakers ?? [];
    const book =
      (preferredBookmaker && books.find((b) => b.key === preferredBookmaker)) || books[0];

    if (!book) {
      problems.push({ eventId, message: `No bookmaker quoted ${awayTeamId} at ${homeTeamId}.` });
      continue;
    }

    const spreads = (book.markets ?? []).find((m) => m.key === "spreads");
    const outcomes = spreads?.outcomes ?? [];
    if (outcomes.length === 0) {
      problems.push({ eventId, message: `No spread quoted for ${awayTeamId} at ${homeTeamId}.` });
      continue;
    }

    // The favourite is the side laying points: a negative `point`.
    let favoriteTeamId: string | null = null;
    let magnitude = 0;

    for (const outcome of outcomes) {
      const teamId = teamIdFor(String(outcome.name ?? ""));
      const point = Number(outcome.point);
      if (teamId === null || Number.isNaN(point)) continue;
      if (point < 0) {
        favoriteTeamId = teamId;
        magnitude = Math.abs(point);
      }
    }

    // All outcomes at zero is a genuine pick'em, not a missing line.
    if (favoriteTeamId === null) {
      const allZero = outcomes.every((o) => Number(o.point) === 0);
      if (!allZero) {
        problems.push({
          eventId,
          message: `Could not identify a favourite for ${awayTeamId} at ${homeTeamId}.`,
        });
        continue;
      }
    }

    lines.push({
      providerEventId: eventId,
      bookmaker: String(book.title ?? book.key ?? "unknown"),
      awayTeamId,
      homeTeamId,
      commenceTime: new Date(String(event.commence_time ?? "")),
      favoriteTeamId,
      spread: magnitude,
    });
  }

  return { lines, problems };
}

// ---------------------------------------------------------------- fetching

function requireKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    throw new Error(
      "ODDS_API_KEY is not set. Scores and lines come from The Odds API because ESPN refuses server requests (D35).",
    );
  }
  return key;
}

async function getJson(url: string): Promise<{ body: unknown; creditsRemaining: string | null }> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const creditsRemaining = response.headers.get("x-requests-remaining");

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `The Odds API responded ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }

  return { body: await response.json(), creditsRemaining };
}

/**
 * Completed and upcoming games.
 * `daysFrom` may only be 1-3; anything older is unavailable from this endpoint.
 */
export async function fetchScores(daysFrom = 3): Promise<ParsedScores & { creditsRemaining: string | null }> {
  const days = Math.min(3, Math.max(1, Math.round(daysFrom)));
  const url = `${ODDS_API_BASE}/sports/${NFL_SPORT_KEY}/scores/?apiKey=${requireKey()}&daysFrom=${days}&dateFormat=iso`;
  const { body, creditsRemaining } = await getJson(url);
  return { ...parseScores(body), creditsRemaining };
}

/** Current spreads for upcoming games. Costs 1 credit per region per market. */
export async function fetchLines(
  preferredBookmaker?: string,
): Promise<ParsedLines & { creditsRemaining: string | null }> {
  const url = `${ODDS_API_BASE}/sports/${NFL_SPORT_KEY}/odds/?apiKey=${requireKey()}&regions=us&markets=spreads&oddsFormat=american&dateFormat=iso`;
  const { body, creditsRemaining } = await getJson(url);
  return { ...parseLines(body, preferredBookmaker), creditsRemaining };
}
