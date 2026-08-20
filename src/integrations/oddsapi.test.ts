import { describe, expect, it } from "vitest";
import { parseLines, parseScores, teamIdFor } from "./oddsapi";

/**
 * Two kinds of test below.
 *
 * The hand-built payloads exercise the cases that matter — an away favourite, a
 * pick'em, a completed game missing a score — which real data may not contain
 * on any given day.
 *
 * The captured payloads are REAL responses from The Odds API, so a change in the
 * provider's shape fails here rather than silently producing wrong picks.
 */

const completedGame = {
  id: "evt-1",
  sport_key: "americanfootball_nfl",
  commence_time: "2026-09-13T17:00:00Z",
  completed: true,
  home_team: "Philadelphia Eagles",
  away_team: "Dallas Cowboys",
  // Deliberately listed away-first to prove position is not relied upon.
  scores: [
    { name: "Dallas Cowboys", score: "17" },
    { name: "Philadelphia Eagles", score: "24" },
  ],
};

describe("teamIdFor", () => {
  it("maps full provider names to our abbreviations", () => {
    expect(teamIdFor("Kansas City Chiefs")).toBe("KC");
    expect(teamIdFor("Washington Commanders")).toBe("WSH");
    expect(teamIdFor("Las Vegas Raiders")).toBe("LV");
    expect(teamIdFor("Jacksonville Jaguars")).toBe("JAX");
  });

  it("tolerates surrounding whitespace", () => {
    expect(teamIdFor("  Green Bay Packers ")).toBe("GB");
  });

  it("returns null for anything unrecognised rather than guessing", () => {
    // Guessing here would grade someone's pick against the wrong game.
    expect(teamIdFor("Las Vegas Raiders FC")).toBeNull();
    expect(teamIdFor("")).toBeNull();
  });

  it("covers all 32 teams", () => {
    const all = [
      "Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills",
      "Carolina Panthers","Chicago Bears","Cincinnati Bengals","Cleveland Browns",
      "Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers",
      "Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs",
      "Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins",
      "Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants",
      "New York Jets","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers",
      "Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders",
    ];
    expect(all.length).toBe(32);
    expect(new Set(all.map(teamIdFor)).size).toBe(32);
    expect(all.every((n) => teamIdFor(n) !== null)).toBe(true);
  });
});

describe("parseScores", () => {
  it("reads a completed game by matching names, not array position", () => {
    const { scores } = parseScores([completedGame]);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({
      awayTeamId: "DAL",
      homeTeamId: "PHI",
      completed: true,
      awayScore: 17,
      homeScore: 24,
    });
  });

  it("does NOT trust scores on a game still in progress", () => {
    // A live score treated as final could eliminate someone at half time.
    const live = { ...completedGame, completed: false, scores: [
      { name: "Dallas Cowboys", score: "7" },
      { name: "Philadelphia Eagles", score: "3" },
    ] };
    const { scores } = parseScores([live]);
    expect(scores[0]?.completed).toBe(false);
    expect(scores[0]?.awayScore).toBeNull();
    expect(scores[0]?.homeScore).toBeNull();
  });

  it("treats a completed game with missing scores as a problem, not a 0-0", () => {
    const broken = { ...completedGame, scores: [{ name: "Dallas Cowboys", score: "17" }] };
    const { scores, problems } = parseScores([broken]);
    expect(scores).toHaveLength(0);
    expect(problems[0]?.message).toMatch(/incomplete/i);
  });

  it("refuses an unrecognised team rather than syncing it", () => {
    const odd = { ...completedGame, home_team: "Philadelphia Eagles FC" };
    const { scores, problems } = parseScores([odd]);
    expect(scores).toHaveLength(0);
    expect(problems[0]?.message).toMatch(/Unrecognised team/i);
  });

  it("handles an empty response", () => {
    expect(parseScores([]).scores).toEqual([]);
    expect(parseScores(null).scores).toEqual([]);
  });
});

describe("parseLines", () => {
  const event = (points: Array<{ name: string; point: number }>) => ({
    id: "evt-2",
    commence_time: "2026-09-13T17:00:00Z",
    home_team: "Philadelphia Eagles",
    away_team: "Dallas Cowboys",
    bookmakers: [
      {
        key: "draftkings",
        title: "DraftKings",
        markets: [{ key: "spreads", outcomes: points }],
      },
    ],
  });

  it("identifies the HOME favourite from the negative point", () => {
    const { lines } = parseLines([
      event([
        { name: "Philadelphia Eagles", point: -3.5 },
        { name: "Dallas Cowboys", point: 3.5 },
      ]),
    ]);
    expect(lines[0]).toMatchObject({ favoriteTeamId: "PHI", spread: 3.5 });
  });

  it("identifies the AWAY favourite just as reliably", () => {
    // The classic bug is assuming home is favoured; this asserts otherwise.
    const { lines } = parseLines([
      event([
        { name: "Philadelphia Eagles", point: 6 },
        { name: "Dallas Cowboys", point: -6 },
      ]),
    ]);
    expect(lines[0]).toMatchObject({ favoriteTeamId: "DAL", spread: 6 });
  });

  it("treats an all-zero line as a genuine pick'em", () => {
    const { lines, problems } = parseLines([
      event([
        { name: "Philadelphia Eagles", point: 0 },
        { name: "Dallas Cowboys", point: 0 },
      ]),
    ]);
    expect(lines[0]?.favoriteTeamId).toBeNull();
    expect(lines[0]?.spread).toBe(0);
    expect(problems).toHaveLength(0);
  });

  it("records which bookmaker supplied the line", () => {
    const { lines } = parseLines([
      event([
        { name: "Philadelphia Eagles", point: -3 },
        { name: "Dallas Cowboys", point: 3 },
      ]),
    ]);
    expect(lines[0]?.bookmaker).toBe("DraftKings");
  });

  it("prefers a named bookmaker when one is available", () => {
    const multi = {
      ...event([]),
      bookmakers: [
        {
          key: "fanduel", title: "FanDuel",
          markets: [{ key: "spreads", outcomes: [
            { name: "Philadelphia Eagles", point: -2.5 },
            { name: "Dallas Cowboys", point: 2.5 },
          ] }],
        },
        {
          key: "draftkings", title: "DraftKings",
          markets: [{ key: "spreads", outcomes: [
            { name: "Philadelphia Eagles", point: -3.5 },
            { name: "Dallas Cowboys", point: 3.5 },
          ] }],
        },
      ],
    };
    expect(parseLines([multi], "draftkings").lines[0]).toMatchObject({
      bookmaker: "DraftKings",
      spread: 3.5,
    });
    expect(parseLines([multi]).lines[0]).toMatchObject({ bookmaker: "FanDuel", spread: 2.5 });
  });

  it("reports a game nobody quoted rather than inventing a line", () => {
    const unquoted = { ...event([]), bookmakers: [] };
    const { lines, problems } = parseLines([unquoted]);
    expect(lines).toHaveLength(0);
    expect(problems[0]?.message).toMatch(/No bookmaker/i);
  });
});


// ---------------------------------------------------------------- real captures

import realScores from "./fixtures/oddsapi-scores.json";
import realOdds from "./fixtures/oddsapi-odds.json";

describe("against real captured responses", () => {
  it("parses every scores event without a problem", () => {
    const { scores, problems } = parseScores(realScores);
    expect(scores.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it("parses every odds event and finds a line for each", () => {
    const { lines, problems } = parseLines(realOdds, "draftkings");
    expect(lines.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it("recognises every team name the provider actually uses", () => {
    // An unmapped name would grade a pick against the wrong game, so this is
    // the assertion most worth having on real data.
    const names = new Set<string>();
    for (const event of [...(realScores as unknown[]), ...(realOdds as unknown[])]) {
      const e = event as { home_team?: string; away_team?: string };
      if (e.home_team) names.add(e.home_team);
      if (e.away_team) names.add(e.away_team);
    }
    const unmapped = [...names].filter((n) => teamIdFor(n) === null);
    expect(unmapped, `unmapped: ${unmapped.join(", ")}`).toEqual([]);
  });

  it("never reports a negative spread magnitude", () => {
    for (const line of parseLines(realOdds).lines) {
      expect(line.spread, `${line.awayTeamId}@${line.homeTeamId}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("agrees with ESPN on the same game — SEA favoured by 3.5 over NE", () => {
    // Independent confirmation of favourite detection: ESPN's own payload gives
    // "SEA -3.5" for this fixture, and a different provider agrees.
    const line = parseLines(realOdds).lines.find(
      (l) => l.awayTeamId === "NE" && l.homeTeamId === "SEA",
    );
    expect(line?.favoriteTeamId).toBe("SEA");
    expect(line?.spread).toBe(3.5);
  });
});
