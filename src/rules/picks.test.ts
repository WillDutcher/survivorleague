import { describe, expect, it } from "vitest";
import { SEASON_2026 } from "./config";
import { defaultPicksFor, rankCandidates } from "./defaults";
import { canMeetRequirement, legalTeamsFor, validatePick } from "./eligibility";
import { isEditable, lockTimeFor, sundayDeadlineFor, weekStartsAt } from "./locks";
import type { EntryState, Game, LeagueLine } from "./types";

const cfg = SEASON_2026;

/** Week 1 of a notional season: Sunday deadline is Sept 13, 2026, 12:55 PM ET. */
const SUNDAY_DEADLINE = sundayDeadlineFor(2026, 9, 13, cfg);

function game(
  id: string,
  away: string,
  home: string,
  kickoffIso: string,
  overrides: Partial<Game> = {},
): Game {
  return {
    id,
    week: 1,
    awayTeamId: away,
    homeTeamId: home,
    kickoff: new Date(kickoffIso),
    status: "scheduled",
    awayScore: null,
    homeScore: null,
    ...overrides,
  };
}

function entry(overrides: Partial<EntryState> = {}): EntryState {
  return {
    id: "e1",
    tier: "TWENTY",
    status: "active",
    committedTeamIds: [],
    requiredPicks: 1,
    includedRebuysRemaining: 0,
    ...overrides,
  };
}

// 1:00 PM ET on Sept 13 2026 = 17:00 UTC (EDT, UTC-4).
const SUN_EARLY = "2026-09-13T17:00:00Z";
const SUN_LATE = "2026-09-13T20:05:00Z";
const SUN_NIGHT = "2026-09-14T00:20:00Z";
const MON_NIGHT = "2026-09-15T00:15:00Z";
const THU_NIGHT = "2026-09-10T00:20:00Z";

describe("Sunday deadline is DST-correct Eastern Time", () => {
  it("resolves 12:55 PM ET in September to 16:55 UTC (EDT)", () => {
    expect(SUNDAY_DEADLINE.toISOString()).toBe("2026-09-13T16:55:00.000Z");
  });

  it("resolves 12:55 PM ET in January to 17:55 UTC (EST)", () => {
    expect(sundayDeadlineFor(2027, 1, 3, cfg).toISOString()).toBe("2027-01-03T17:55:00.000Z");
  });
});

describe("lock times", () => {
  it("a Sunday afternoon game locks at the 12:55 deadline", () => {
    expect(lockTimeFor(new Date(SUN_EARLY), SUNDAY_DEADLINE, cfg)).toEqual(SUNDAY_DEADLINE);
  });

  it("Sunday night and Monday games also lock at the 12:55 deadline", () => {
    expect(lockTimeFor(new Date(SUN_NIGHT), SUNDAY_DEADLINE, cfg)).toEqual(SUNDAY_DEADLINE);
    expect(lockTimeFor(new Date(MON_NIGHT), SUNDAY_DEADLINE, cfg)).toEqual(SUNDAY_DEADLINE);
  });

  it("a Thursday game locks 5 minutes before its own kickoff", () => {
    const lock = lockTimeFor(new Date(THU_NIGHT), SUNDAY_DEADLINE, cfg);
    expect(lock.toISOString()).toBe("2026-09-10T00:15:00.000Z");
  });

  it("a pick is editable up to the instant it locks, and not after", () => {
    const lock = new Date("2026-09-13T16:55:00Z");
    expect(isEditable(lock, new Date("2026-09-13T16:54:59Z"))).toBe(true);
    expect(isEditable(lock, new Date("2026-09-13T16:55:00Z"))).toBe(false);
    expect(isEditable(lock, new Date("2026-09-13T16:55:01Z"))).toBe(false);
  });

  it("a week starts at its earliest kickoff, whatever day that is (D19a)", () => {
    const wednesday = new Date("2026-09-09T00:15:00Z");
    const start = weekStartsAt([new Date(SUN_EARLY), wednesday, new Date(THU_NIGHT)]);
    expect(start).toEqual(wednesday);
  });
});

describe("no-reuse enforcement", () => {
  const games = [
    game("g1", "DAL", "PHI", SUN_EARLY),
    game("g2", "NYG", "WAS", SUN_EARLY),
  ];

  it("accepts a first-time team", () => {
    const result = validatePick(entry(), "PHI", games);
    expect(result.ok).toBe(true);
  });

  it("rejects a team already used this season", () => {
    const result = validatePick(entry({ committedTeamIds: ["PHI"] }), "PHI", games);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("already_used");
  });

  it("rejects a team reserved for a different week, and says which", () => {
    const result = validatePick(entry({ committedTeamIds: ["WAS"] }), "WAS", games, {
      reservedInWeek: new Map([["WAS", 9]]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("reserved_other_week");
      expect(result.message).toMatch(/Week 9/);
    }
  });

  it("still allows changing to the team already picked for THIS week", () => {
    const result = validatePick(entry({ committedTeamIds: ["PHI"] }), "PHI", games, {
      currentWeekTeamIds: ["PHI"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a team that does not play this week", () => {
    const result = validatePick(entry(), "KC", games);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_team");
  });

  it("rejects a pick once the game has locked", () => {
    const result = validatePick(entry(), "PHI", games, {
      lockAtByGameId: new Map([["g1", SUNDAY_DEADLINE]]),
      now: new Date(SUNDAY_DEADLINE.getTime() + 1000),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("locked");
  });

  it("rejects picks from an entry that is not active", () => {
    const result = validatePick(entry({ status: "registered" }), "PHI", games);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/paid and confirmed/i);
  });

  it("no-reuse survives a rebuy — history is never cleared", () => {
    // Entry lost, rebought, and is active again with its burned teams intact.
    const rebought = entry({ committedTeamIds: ["PHI", "NYG"], requiredPicks: 1 });
    expect(legalTeamsFor(rebought, games).sort()).toEqual(["DAL", "WAS"]);
  });
});

describe("default picks — strongest legal favorite", () => {
  const games = [
    game("g1", "DAL", "PHI", SUN_EARLY), // PHI -9.5
    game("g2", "NYG", "WAS", SUN_LATE), // WAS -3
    game("g3", "CHI", "GB", SUN_NIGHT), // GB -7
  ];
  const lines: LeagueLine[] = [
    { gameId: "g1", favoriteTeamId: "PHI", spread: 9.5 },
    { gameId: "g2", favoriteTeamId: "WAS", spread: 3 },
    { gameId: "g3", favoriteTeamId: "GB", spread: 7 },
  ];

  it("chooses the biggest favorite", () => {
    const result = defaultPicksFor(entry(), games, lines, 1, cfg);
    expect(result.assignments[0]?.teamId).toBe("PHI");
  });

  it("skips a favorite the entry has already used", () => {
    const used = entry({ committedTeamIds: ["PHI"] });
    const result = defaultPicksFor(used, games, lines, 1, cfg);
    expect(result.assignments[0]?.teamId).toBe("GB");
  });

  it("skips teams reserved in a future week", () => {
    const reserved = entry({ committedTeamIds: ["PHI", "GB"] });
    const result = defaultPicksFor(reserved, games, lines, 1, cfg, {
      reservedInWeek: new Map([["GB", 12]]),
    });
    expect(result.assignments[0]?.teamId).toBe("WAS");
  });

  it("assigns N teams in a multi-pick week, strongest first", () => {
    const owing = entry({ requiredPicks: 2 });
    const result = defaultPicksFor(owing, games, lines, 5, cfg);
    expect(result.assignments.map((a) => a.teamId)).toEqual(["PHI", "GB"]);
  });

  it("falls back to underdogs, least-bad first, when favorites are exhausted", () => {
    const burned = entry({ committedTeamIds: ["PHI", "WAS", "GB"] });
    const result = defaultPicksFor(burned, games, lines, 1, cfg);
    // Remaining: DAL (+9.5), NYG (+3), CHI (+7) -> NYG is least-bad.
    expect(result.assignments[0]?.teamId).toBe("NYG");
  });

  it("records the full candidate list and rule version for audit", () => {
    const result = defaultPicksFor(entry(), games, lines, 1, cfg);
    expect(result.candidatesConsidered).toHaveLength(6);
    expect(result.ruleVersion).toBe("strongest-legal-favorite@1");
    expect(result.assignments[0]?.rationale).toMatch(/favored by 9.5/);
  });

  it("flags a shortfall rather than silently under-assigning (D17c)", () => {
    const nearlyBurned = entry({
      requiredPicks: 4,
      committedTeamIds: ["PHI", "WAS", "GB", "DAL"],
    });
    const result = defaultPicksFor(nearlyBurned, games, lines, 6, cfg);
    expect(result.shortfall).toBe(true);
    expect(canMeetRequirement(nearlyBurned, games)).toBe(false);
  });
});

describe("default picks — equal-line tie-breaks are deterministic", () => {
  it("prefers the home team when lines are equal", () => {
    const games = [
      game("g1", "DAL", "PHI", SUN_EARLY),
      game("g2", "NYG", "WAS", SUN_EARLY),
    ];
    // PHI is home and favored by 7; NYG is away and favored by 7.
    const lines: LeagueLine[] = [
      { gameId: "g1", favoriteTeamId: "PHI", spread: 7 },
      { gameId: "g2", favoriteTeamId: "NYG", spread: 7 },
    ];
    expect(defaultPicksFor(entry(), games, lines, 1, cfg).assignments[0]?.teamId).toBe("PHI");
  });

  it("prefers the earlier game when line and home status are equal", () => {
    const games = [
      game("g1", "DAL", "PHI", SUN_LATE),
      game("g2", "NYG", "WAS", SUN_EARLY),
    ];
    const lines: LeagueLine[] = [
      { gameId: "g1", favoriteTeamId: "PHI", spread: 7 },
      { gameId: "g2", favoriteTeamId: "WAS", spread: 7 },
    ];
    expect(defaultPicksFor(entry(), games, lines, 1, cfg).assignments[0]?.teamId).toBe("WAS");
  });

  it("produces the identical result regardless of input ordering", () => {
    const games = [
      game("g1", "DAL", "PHI", SUN_EARLY),
      game("g2", "NYG", "WAS", SUN_EARLY),
      game("g3", "CHI", "GB", SUN_EARLY),
    ];
    const lines: LeagueLine[] = [
      { gameId: "g1", favoriteTeamId: "PHI", spread: 7 },
      { gameId: "g2", favoriteTeamId: "WAS", spread: 7 },
      { gameId: "g3", favoriteTeamId: "GB", spread: 7 },
    ];
    const forward = rankCandidates(["PHI", "WAS", "GB"], games, lines).map((c) => c.teamId);
    const reversed = rankCandidates(["GB", "WAS", "PHI"], [...games].reverse(), lines).map(
      (c) => c.teamId,
    );
    expect(forward).toEqual(reversed);
  });

  it("is stable across repeated runs — the same inputs always give the same answer", () => {
    const games = [game("g1", "DAL", "PHI", SUN_EARLY), game("g2", "NYG", "WAS", SUN_EARLY)];
    const lines: LeagueLine[] = [
      { gameId: "g1", favoriteTeamId: "PHI", spread: 3 },
      { gameId: "g2", favoriteTeamId: "WAS", spread: 3 },
    ];
    const runs = Array.from({ length: 20 }, () =>
      defaultPicksFor(entry(), games, lines, 1, cfg).assignments[0]?.teamId,
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("postponed and non-playable games", () => {
  it("a postponed game is not selectable", () => {
    const games = [game("g1", "DAL", "PHI", SUN_EARLY, { status: "postponed" })];
    const result = validatePick(entry(), "PHI", games);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("game_not_playable");
  });

  it("a postponed game is excluded from default-pick candidates", () => {
    const games = [
      game("g1", "DAL", "PHI", SUN_EARLY, { status: "postponed" }),
      game("g2", "NYG", "WAS", SUN_EARLY),
    ];
    const lines: LeagueLine[] = [
      { gameId: "g1", favoriteTeamId: "PHI", spread: 14 },
      { gameId: "g2", favoriteTeamId: "WAS", spread: 1 },
    ];
    expect(defaultPicksFor(entry(), games, lines, 1, cfg).assignments[0]?.teamId).toBe("WAS");
  });
});
