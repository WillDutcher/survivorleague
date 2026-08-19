import { describe, expect, it } from "vitest";
import teamsFixture from "./fixtures/espn-teams.json";
import week1Fixture from "./fixtures/espn-week1.json";
import preseasonFixture from "./fixtures/espn-preseason-week3.json";
import { mapStatus, parseLines, parseScoreboard, parseTeams } from "./espn";
import { weekLabel } from "../rules/weeks";

/**
 * These run against real captured ESPN payloads. The endpoint is unofficial and
 * can change without notice, so the point of these tests is early warning: if
 * upstream changes shape, this fails loudly instead of quietly producing wrong
 * kickoff times or scores.
 */

describe("parseTeams", () => {
  const teams = parseTeams(teamsFixture);

  it("finds all 32 teams", () => {
    expect(teams).toHaveLength(32);
  });

  it("extracts colors for pick controls", () => {
    const ari = teams.find((t) => t.abbreviation === "ARI");
    expect(ari?.colorPrimary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ari?.city).toBe("Arizona");
    expect(ari?.name).toBe("Cardinals");
  });

  it("assigns every team a conference and division", () => {
    for (const team of teams) {
      expect(team.conference, team.abbreviation).toMatch(/^(AFC|NFC)$/);
      expect(team.division, team.abbreviation).toMatch(/^(East|North|South|West)$/);
    }
  });

  it("has exactly 16 teams per conference", () => {
    expect(teams.filter((t) => t.conference === "AFC")).toHaveLength(16);
    expect(teams.filter((t) => t.conference === "NFC")).toHaveLength(16);
  });

  it("throws rather than returning nothing if the shape changes", () => {
    expect(() => parseTeams({})).toThrow(/shape may have changed/i);
  });
});

describe("parseScoreboard — real 2026 Week 1", () => {
  const week = parseScoreboard(week1Fixture);

  it("reads the season and week", () => {
    expect(week.seasonYear).toBe(2026);
    expect(week.weekNumber).toBe(1);
  });

  it("finds every game", () => {
    expect(week.games).toHaveLength(16);
  });

  it("recognizes every status ESPN returned", () => {
    expect(week.unknownStatuses).toEqual([]);
  });

  it("parses kickoff as a real instant", () => {
    for (const game of week.games) {
      expect(Number.isNaN(game.kickoff.getTime()), game.providerGameId).toBe(false);
    }
  });

  /**
   * The 2026 season opens on a WEDNESDAY. This is exactly why a week's start is
   * derived from its earliest kickoff rather than hardcoded to Thursday (D19a).
   */
  it("has a Wednesday opener, not a Thursday one", () => {
    const earliest = week.games.reduce((a, b) => (a.kickoff < b.kickoff ? a : b));
    const dayInEastern = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
    }).format(earliest.kickoff);
    expect(dayInEastern).toBe("Wednesday");
  });

  it("does not invent scores for games that have not been played", () => {
    // ESPN reports "0" for both sides pre-kickoff. Treating that as a real score
    // would make every unplayed game look like a 0-0 tie.
    for (const game of week.games.filter((g) => g.status !== "final")) {
      expect(game.awayScore, game.providerGameId).toBeNull();
      expect(game.homeScore, game.providerGameId).toBeNull();
    }
  });

  it("never has a team playing itself", () => {
    for (const game of week.games) {
      expect(game.awayAbbr).not.toBe(game.homeAbbr);
    }
  });

  it("never schedules a team twice in one week", () => {
    const seen = new Set<string>();
    for (const game of week.games) {
      for (const team of [game.awayAbbr, game.homeAbbr]) {
        expect(seen.has(team), `${team} appears twice`).toBe(false);
        seen.add(team);
      }
    }
  });
});

describe("mapStatus", () => {
  it("maps the states we know", () => {
    expect(mapStatus("STATUS_SCHEDULED")).toBe("scheduled");
    expect(mapStatus("STATUS_IN_PROGRESS")).toBe("in_progress");
    expect(mapStatus("STATUS_FINAL")).toBe("final");
    expect(mapStatus("STATUS_FINAL_OVERTIME")).toBe("final");
    expect(mapStatus("STATUS_POSTPONED")).toBe("postponed");
    expect(mapStatus("STATUS_SUSPENDED")).toBe("canceled");
  });

  it("returns null for anything unrecognized rather than guessing", () => {
    // A guess here could advance or eliminate someone on a state we do not
    // understand. Null routes it to an admin exception instead.
    expect(mapStatus("STATUS_SOMETHING_NEW")).toBeNull();
    expect(mapStatus("")).toBeNull();
  });
});

describe("parseLines — spreads from the same payload (D29)", () => {
  const lines = parseLines(week1Fixture);

  it("finds a line for every game", () => {
    expect(lines).toHaveLength(16);
  });

  it("always reports a positive magnitude", () => {
    for (const line of lines) {
      expect(line.spread, line.providerGameId).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * ESPN's `spread` is signed from the HOME team's perspective, so deriving the
   * favorite from its sign alone gets away favorites exactly backwards. These
   * assert the favorite matches the `details` string, which names it outright.
   */
  it("identifies the favorite correctly when the HOME team is favored", () => {
    const seaGame = lines.find((l) => l.details === "SEA -3.5");
    expect(seaGame?.favoriteAbbr).toBe("SEA");
    expect(seaGame?.spread).toBe(3.5);
  });

  it("identifies the favorite correctly when the AWAY team is favored", () => {
    // BAL at IND, with Baltimore favored on the road: signed spread is +3.5.
    const balGame = lines.find((l) => l.details === "BAL -3.5");
    expect(balGame?.favoriteAbbr).toBe("BAL");
    expect(balGame?.spread).toBe(3.5);
  });

  it("agrees with the details string for every single game", () => {
    for (const line of lines) {
      if (!line.details) continue;
      const [namedFavorite] = line.details.split(" ");
      expect(line.favoriteAbbr, line.details).toBe(namedFavorite);
    }
  });

  it("records which sportsbook supplied the line", () => {
    for (const line of lines) {
      expect(line.provider.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Guard against pointing the league at the wrong `seasontype`.
 *
 * ESPN uses seasontype=1 for preseason and 2 for the regular season, and
 * espn.com/nfl/odds shows whichever is next — which in August is preseason.
 * Syncing exhibition games as if they counted would be catastrophic and silent,
 * so this fixture is kept specifically as the thing we must never treat as real.
 */
describe("preseason is a different season type", () => {
  const preseason = parseScoreboard(preseasonFixture);
  const lines = parseLines(preseasonFixture);

  it("parses preseason games with the same code path", () => {
    expect(preseason.games.length).toBeGreaterThan(0);
  });

  it("reads the LV at HOU preseason line as HOU -1.5", () => {
    const game = preseason.games.find((g) => g.awayAbbr === "LV" && g.homeAbbr === "HOU");
    expect(game).toBeDefined();

    const line = lines.find((l) => l.providerGameId === game?.providerGameId);
    expect(line?.favoriteAbbr).toBe("HOU");
    expect(line?.spread).toBe(1.5);
    expect(line?.details).toBe("HOU -1.5");
  });

  it("does not collide with regular-season Week 1 game ids", () => {
    const regularIds = new Set(parseScoreboard(week1Fixture).games.map((g) => g.providerGameId));
    for (const game of preseason.games) {
      expect(regularIds.has(game.providerGameId), game.providerGameId).toBe(false);
    }
  });
});

/**
 * ESPN's preseason week numbers are offset by one from the labels the NFL shows,
 * because API week 1 is the Hall of Fame game. Getting this wrong means players
 * see "Week 3" while NFL.com says "PRE WK 2" for the same games.
 */
describe("preseason week numbering", () => {
  it("API preseason week 3 is what the NFL calls Preseason Week 2", () => {
    const week = parseScoreboard(preseasonFixture);
    expect(week.weekNumber).toBe(3);
    expect(weekLabel(1, week.weekNumber)).toBe("Preseason Week 2");
  });

  it("API week 1 is the Hall of Fame game, not Preseason Week 1", () => {
    expect(weekLabel(1, 1)).toBe("Hall of Fame Game");
  });

  it("maps the whole preseason the way the NFL labels it", () => {
    expect(weekLabel(1, 2)).toBe("Preseason Week 1");
    expect(weekLabel(1, 3)).toBe("Preseason Week 2");
    expect(weekLabel(1, 4)).toBe("Preseason Week 3");
  });

  it("leaves regular-season weeks alone", () => {
    expect(weekLabel(2, 1)).toBe("Week 1");
    expect(weekLabel(2, 18)).toBe("Week 18");
  });
});
