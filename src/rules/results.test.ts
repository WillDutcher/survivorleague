import { describe, expect, it } from "vitest";
import { SEASON_2026 } from "./config";
import { outcomeFor, resolveWeek } from "./results";
import type { PickOutcome } from "./types";

const cfg = SEASON_2026;

describe("resolveWeek — ordinary weeks", () => {
  it("a single win survives and keeps a normal single-pick week", () => {
    const r = resolveWeek(["win"], 3, cfg);
    expect(r.verdict).toBe("survived");
    expect(r.nextRequiredPicks).toBe(1);
  });

  it("a single loss is a loss", () => {
    const r = resolveWeek(["loss"], 3, cfg);
    expect(r.verdict).toBe("lost");
  });

  it("does not resolve while a game is still pending", () => {
    const r = resolveWeek(["pending"], 3, cfg);
    expect(r.verdict).toBe("pending");
  });

  it("a loss is decisive even if another game has not finished", () => {
    // Waiting on the second game cannot change the outcome — any loss is a loss.
    const r = resolveWeek(["loss", "pending"], 5, cfg);
    expect(r.verdict).toBe("lost");
  });
});

/**
 * The commissioner's own worked examples (DECISIONS.md D17), verbatim.
 * If any of these fail, the league rule has been broken.
 */
describe("resolveWeek — the tie-doubling rule, commissioner's worked cases", () => {
  it("1 pick ties -> 2 required next week", () => {
    const r = resolveWeek(["tie"], 4, cfg);
    expect(r.verdict).toBe("survived");
    expect(r.nextRequiredPicks).toBe(2);
  });

  it("2 required, both win -> back to 1", () => {
    const r = resolveWeek(["win", "win"], 5, cfg);
    expect(r.verdict).toBe("survived");
    expect(r.nextRequiredPicks).toBe(1);
  });

  it("2 required, win + loss -> loss", () => {
    const r = resolveWeek(["win", "loss"], 5, cfg);
    expect(r.verdict).toBe("lost");
  });

  it("2 required, win + tie -> 2 required next week (the win does NOT pay down the debt)", () => {
    const r = resolveWeek(["win", "tie"], 5, cfg);
    expect(r.verdict).toBe("survived");
    expect(r.nextRequiredPicks).toBe(2);
  });

  it("2 required, tie + tie -> 4 required next week", () => {
    const r = resolveWeek(["tie", "tie"], 5, cfg);
    expect(r.verdict).toBe("survived");
    expect(r.nextRequiredPicks).toBe(4);
  });

  it("2 required, tie + loss -> loss", () => {
    const r = resolveWeek(["tie", "loss"], 5, cfg);
    expect(r.verdict).toBe("lost");
  });
});

describe("resolveWeek — general form of the rule", () => {
  it("next requirement is always multiplier x ties, regardless of wins alongside", () => {
    const cases: Array<[PickOutcome[], number]> = [
      [["tie"], 2],
      [["win", "tie"], 2],
      [["win", "win", "tie"], 2],
      [["tie", "tie"], 4],
      [["win", "tie", "tie"], 4],
      [["tie", "tie", "tie"], 6],
    ];
    for (const [outcomes, expected] of cases) {
      expect(resolveWeek(outcomes, 6, cfg).nextRequiredPicks, outcomes.join("+")).toBe(expected);
    }
  });

  it("wins alone never increase the requirement", () => {
    expect(resolveWeek(["win", "win", "win", "win"], 6, cfg).nextRequiredPicks).toBe(1);
  });
});

describe("resolveWeek — Week 18 (D17a)", () => {
  it("a tie in the final week is a loss — you do not advance on a tie", () => {
    const r = resolveWeek(["tie"], 18, cfg);
    expect(r.verdict).toBe("lost");
    expect(r.reason).toMatch(/do not advance on a tie/i);
  });

  it("a tie in Week 17 still doubles normally", () => {
    const r = resolveWeek(["tie"], 17, cfg);
    expect(r.verdict).toBe("survived");
    expect(r.nextRequiredPicks).toBe(2);
  });

  it("a win in the final week survives", () => {
    expect(resolveWeek(["win"], 18, cfg).verdict).toBe("survived");
  });

  it("a multi-pick tie in the final week is still a loss", () => {
    expect(resolveWeek(["win", "tie"], 18, cfg).verdict).toBe("lost");
  });
});

describe("outcomeFor", () => {
  it("reads a win for the home team", () => {
    expect(outcomeFor("PHI", "PHI", "DAL", 24, 17, true)).toBe("win");
  });

  it("reads a win for the away team", () => {
    expect(outcomeFor("DAL", "PHI", "DAL", 17, 24, true)).toBe("win");
  });

  it("reads a loss", () => {
    expect(outcomeFor("DAL", "PHI", "DAL", 24, 17, true)).toBe("loss");
  });

  it("reads a tie", () => {
    expect(outcomeFor("PHI", "PHI", "DAL", 20, 20, true)).toBe("tie");
  });

  it("is pending until the game is final, even with a score on the board", () => {
    expect(outcomeFor("PHI", "PHI", "DAL", 24, 17, false)).toBe("pending");
  });

  it("refuses to grade a team that is not in the game", () => {
    expect(() => outcomeFor("NYG", "PHI", "DAL", 24, 17, true)).toThrow(/not a participant/i);
  });
});
