/**
 * NFL schedule and scores from ESPN's public endpoints.
 *
 * Free and keyless, but unofficial and unsupported: the shape can change without
 * notice. Everything the league needs is persisted locally on sync, so league
 * logic never reads this provider live and a provider outage cannot stall a
 * week (PROJECT_BRIEF).
 *
 * The parsers below are written against real captured payloads in ./fixtures,
 * which are also what the tests run on — so a breaking change upstream shows up
 * as a parse failure with a clear message rather than as silently wrong data.
 */

export const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

export interface EspnTeam {
  providerId: string;
  abbreviation: string;
  city: string;
  name: string;
  colorPrimary: string;
  colorSecondary: string;
  conference: string;
  division: string;
}

export interface EspnGame {
  providerGameId: string;
  weekNumber: number;
  kickoff: Date;
  awayAbbr: string;
  homeAbbr: string;
  status: "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
  awayScore: number | null;
  homeScore: number | null;
}

/**
 * Conference and division are not on the teams endpoint, and they essentially
 * never change, so they live here rather than being fetched. Used only for
 * grouping in the UI — no league rule depends on them.
 */
const ALIGNMENT: Record<string, [string, string]> = {
  BUF: ["AFC", "East"], MIA: ["AFC", "East"], NE: ["AFC", "East"], NYJ: ["AFC", "East"],
  BAL: ["AFC", "North"], CIN: ["AFC", "North"], CLE: ["AFC", "North"], PIT: ["AFC", "North"],
  HOU: ["AFC", "South"], IND: ["AFC", "South"], JAX: ["AFC", "South"], TEN: ["AFC", "South"],
  DEN: ["AFC", "West"], KC: ["AFC", "West"], LV: ["AFC", "West"], LAC: ["AFC", "West"],
  DAL: ["NFC", "East"], NYG: ["NFC", "East"], PHI: ["NFC", "East"], WSH: ["NFC", "East"],
  CHI: ["NFC", "North"], DET: ["NFC", "North"], GB: ["NFC", "North"], MIN: ["NFC", "North"],
  ATL: ["NFC", "South"], CAR: ["NFC", "South"], NO: ["NFC", "South"], TB: ["NFC", "South"],
  ARI: ["NFC", "West"], LAR: ["NFC", "West"], SF: ["NFC", "West"], SEA: ["NFC", "West"],
};

/** ESPN status name -> our game status. Unknown states are treated as exceptions. */
export function mapStatus(statusName: string): EspnGame["status"] | null {
  switch (statusName) {
    case "STATUS_SCHEDULED":
    case "STATUS_DELAYED":
      return "scheduled";
    case "STATUS_IN_PROGRESS":
    case "STATUS_HALFTIME":
    case "STATUS_END_PERIOD":
      return "in_progress";
    case "STATUS_FINAL":
    case "STATUS_FINAL_OVERTIME":
      return "final";
    case "STATUS_POSTPONED":
      return "postponed";
    case "STATUS_CANCELED":
    case "STATUS_SUSPENDED":
      return "canceled";
    default:
      // Never guess. An unrecognized status raises an admin exception upstream
      // rather than being coerced into something that might advance a player.
      return null;
  }
}

export function parseTeams(payload: unknown): EspnTeam[] {
  const root = payload as {
    sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: Record<string, string> }> }> }>;
  };
  const raw = root.sports?.[0]?.leagues?.[0]?.teams;
  if (!raw || raw.length === 0) {
    throw new Error("ESPN teams payload had no teams — the endpoint shape may have changed.");
  }

  return raw.map((entry) => {
    const t = entry.team ?? {};
    const abbreviation = String(t.abbreviation ?? "");
    const [conference, division] = ALIGNMENT[abbreviation] ?? ["", ""];
    return {
      providerId: String(t.id ?? ""),
      abbreviation,
      city: String(t.location ?? ""),
      name: String(t.name ?? ""),
      colorPrimary: `#${String(t.color ?? "444444")}`,
      colorSecondary: `#${String(t.alternateColor ?? "ffffff")}`,
      conference,
      division,
    };
  });
}

export interface ParsedWeek {
  weekNumber: number;
  seasonYear: number;
  games: EspnGame[];
  /** Statuses we did not recognize, surfaced as admin exceptions. */
  unknownStatuses: string[];
}

export function parseScoreboard(payload: unknown): ParsedWeek {
  const root = payload as {
    season?: { year?: number };
    week?: { number?: number };
    events?: Array<Record<string, unknown>>;
  };

  const weekNumber = root.week?.number ?? 0;
  const seasonYear = root.season?.year ?? 0;
  const events = root.events ?? [];
  const games: EspnGame[] = [];
  const unknownStatuses: string[] = [];

  for (const event of events) {
    const competitions = (event.competitions ?? []) as Array<Record<string, unknown>>;
    const competition = competitions[0];
    if (!competition) continue;

    const statusType = (competition.status as { type?: { name?: string } } | undefined)?.type;
    const mapped = mapStatus(String(statusType?.name ?? ""));
    if (!mapped) {
      unknownStatuses.push(String(statusType?.name ?? "unknown"));
      continue;
    }

    const competitors = (competition.competitors ?? []) as Array<{
      homeAway?: string;
      score?: string;
      team?: { abbreviation?: string };
    }>;

    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;

    // Scores are only meaningful once a game is final. ESPN reports "0" before
    // kickoff, and treating that as a real score would show a 0-0 tie for every
    // unplayed game.
    const isFinal = mapped === "final";

    games.push({
      providerGameId: String(event.id ?? ""),
      weekNumber,
      kickoff: new Date(String(event.date ?? "")),
      awayAbbr: away.team.abbreviation,
      homeAbbr: home.team.abbreviation,
      status: mapped,
      awayScore: isFinal ? Number(away.score ?? 0) : null,
      homeScore: isFinal ? Number(home.score ?? 0) : null,
    });
  }

  return { weekNumber, seasonYear, games, unknownStatuses };
}

/**
 * Point spreads, carried on the same scoreboard payload as the schedule (D29).
 *
 * ESPN gives us three usable signals per game: explicit `favorite` booleans on
 * each side, a signed `spread` (always from the HOME team's perspective --
 * negative means home is favored), and a `details` string like "SEA -3.5".
 *
 * The favorite booleans are authoritative here because they are unambiguous;
 * `details` is only a fallback. Deriving the favorite from the sign of `spread`
 * alone is the classic way to get this backwards.
 *
 * Lines move. What matters for the league is the snapshot the commissioner locks
 * on Thursday (D10) -- this parser only captures a candidate.
 */
export interface EspnLine {
  providerGameId: string;
  provider: string;
  /** null at pick'em. */
  favoriteAbbr: string | null;
  /** Positive magnitude, e.g. 3.5 for a 3.5-point favorite. */
  spread: number;
  details: string | null;
}

export function parseLines(payload: unknown): EspnLine[] {
  const root = payload as { events?: Array<Record<string, unknown>> };
  const lines: EspnLine[] = [];

  for (const event of root.events ?? []) {
    const competition = ((event.competitions ?? []) as Array<Record<string, unknown>>)[0];
    if (!competition) continue;

    const odds = ((competition.odds ?? []) as Array<Record<string, unknown>>)[0];
    if (!odds) continue;

    const side = (key: string) =>
      odds[key] as { favorite?: boolean; team?: { abbreviation?: string } } | undefined;
    const away = side("awayTeamOdds");
    const home = side("homeTeamOdds");

    let favoriteAbbr: string | null = null;
    if (home?.favorite && home.team?.abbreviation) favoriteAbbr = home.team.abbreviation;
    else if (away?.favorite && away.team?.abbreviation) favoriteAbbr = away.team.abbreviation;

    const magnitude = Math.abs(Number(odds.spread ?? 0));

    lines.push({
      providerGameId: String(event.id ?? ""),
      provider: String(
        (odds.provider as { name?: string } | undefined)?.name ?? "unknown",
      ),
      // A zero line is a pick'em regardless of what the favorite flags claim.
      favoriteAbbr: magnitude === 0 ? null : favoriteAbbr,
      spread: magnitude,
      details: odds.details ? String(odds.details) : null,
    });
  }

  return lines;
}

// ---------------------------------------------------------------- fetching

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    // Always go to the network: a cached scoreboard during a live Sunday is worse
    // than a slow one.
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`ESPN responded ${response.status} for ${url}`);
  }
  return response.json();
}

export async function fetchTeams(): Promise<EspnTeam[]> {
  return parseTeams(await getJson(`${ESPN_BASE}/teams`));
}

/** 1 = preseason, 2 = regular season. Never guessed; always passed explicitly. */
export type SeasonType = 1 | 2;

export const SEASON_TYPE = {
  preseason: 1,
  regular: 2,
} as const;

export async function fetchWeek(
  seasonYear: number,
  weekNumber: number,
  seasonType: SeasonType = SEASON_TYPE.regular,
): Promise<ParsedWeek & { lines: EspnLine[] }> {
  const url = `${ESPN_BASE}/scoreboard?dates=${seasonYear}&seasontype=${seasonType}&week=${weekNumber}`;
  const payload = await getJson(url);
  // Schedule and odds arrive together, so one request covers both (D29).
  return { ...parseScoreboard(payload), lines: parseLines(payload) };
}
