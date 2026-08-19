import { describe, expect, it } from "vitest";
import { SEASON_2026, type SeasonConfig } from "./config";
import {
  evaluateSplitVote,
  potCents,
  settleSeason,
  splitEvenly,
  splitVoteReminderAt,
  equalSplitProposal,
  validateSplitProposal,
  type PaymentRecord,
  type SplitBallot,
  type SplitProposal,
} from "./settlement";

const cfg = SEASON_2026;
const practice: SeasonConfig = { ...SEASON_2026, mode: "practice" };

const OPENED = new Date("2026-11-10T05:00:00Z"); // Monday night, after results
const CLOSES = new Date("2026-11-13T00:15:00Z"); // Thursday kickoff, next week begins
const BEFORE_CLOSE = new Date("2026-11-12T12:00:00Z");
const AFTER_CLOSE = new Date("2026-11-13T00:20:00Z");

function ballots(...responses: Array<[string, SplitBallot["response"]]>): SplitBallot[] {
  return responses.map(([entryId, response]) => ({ entryId, response }));
}

describe("pot accounting", () => {
  const payments: PaymentRecord[] = [
    { entryId: "a", category: "entry", amountCents: 2000, status: "verified" },
    { entryId: "b", category: "entry", amountCents: 8000, status: "verified" },
    { entryId: "c", category: "entry", amountCents: 2000, status: "pending" },
    { entryId: "a", category: "rebuy", amountCents: 3000, status: "verified" },
    { entryId: "b", category: "rebuy", amountCents: 0, status: "verified" }, // included $80 rebuy
  ];

  it("counts only verified payments", () => {
    // 2000 + 8000 + 3000 + 0 — the pending $20 is excluded.
    expect(potCents(payments, cfg)).toBe(13000);
  });

  it("included $80 rebuys add nothing to the pot", () => {
    const withIncluded = potCents(payments, cfg);
    const withoutIncluded = potCents(
      payments.filter((p) => p.amountCents !== 0),
      cfg,
    );
    expect(withIncluded).toBe(withoutIncluded);
  });

  it("a practice season has no pot", () => {
    expect(potCents(payments, practice)).toBe(0);
  });
});

describe("splitEvenly — the money must balance exactly", () => {
  it("divides evenly when it divides evenly", () => {
    const payouts = splitEvenly(60000, ["a", "b", "c"]);
    expect(payouts.map((p) => p.amountCents)).toEqual([20000, 20000, 20000]);
  });

  it("distributes an indivisible remainder without losing a cent", () => {
    // $2,000 among 3 = $666.66 each, 2 cents left over.
    const payouts = splitEvenly(200000, ["a", "b", "c"]);
    expect(payouts.map((p) => p.amountCents)).toEqual([66667, 66667, 66666]);
    expect(payouts.reduce((s, p) => s + p.amountCents, 0)).toBe(200000);
  });

  it("balances for every pot size and survivor count in a wide sweep", () => {
    for (let n = 1; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => `e${i}`);
      for (const pot of [0, 1, 7, 999, 13000, 200000, 200001, 123457]) {
        const total = splitEvenly(pot, ids).reduce((s, p) => s + p.amountCents, 0);
        expect(total, `pot=${pot} n=${n}`).toBe(pot);
      }
    }
  });

  it("is deterministic regardless of the order survivors are supplied in", () => {
    const forward = splitEvenly(200000, ["c", "a", "b"]);
    const reverse = splitEvenly(200000, ["b", "c", "a"]);
    expect(forward).toEqual(reverse);
  });

  it("no payout differs from another by more than one cent", () => {
    const amounts = splitEvenly(123457, ["a", "b", "c", "d", "e"]).map((p) => p.amountCents);
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
  });

  it("refuses a negative pot", () => {
    expect(() => splitEvenly(-1, ["a"])).toThrow(/negative/i);
  });
});

describe("weekly split vote (D19, D19a)", () => {
  it("unanimous yes ends the season and splits the pot", () => {
    const result = evaluateSplitVote(
      ballots(["a", "yes"], ["b", "yes"], ["c", "yes"]),
      200000,
      { openedAt: OPENED, closesAt: CLOSES, now: BEFORE_CLOSE },
    );
    expect(result.status).toBe("accepted");
    expect(result.unanimous).toBe(true);
    expect(result.payouts.reduce((s, p) => s + p.amountCents, 0)).toBe(200000);
  });

  it("a single no removes the option immediately, without waiting for the window", () => {
    const result = evaluateSplitVote(
      ballots(["a", "yes"], ["b", "yes"], ["c", "no"]),
      200000,
      { openedAt: OPENED, closesAt: CLOSES, now: BEFORE_CLOSE },
    );
    expect(result.status).toBe("rejected");
    expect(result.payouts).toEqual([]);
    expect(result.reason).toMatch(/play continues/i);
  });

  it("a majority is never sufficient", () => {
    const result = evaluateSplitVote(
      ballots(["a", "yes"], ["b", "yes"], ["c", "yes"], ["d", "yes"], ["e", "no"]),
      200000,
      { openedAt: OPENED, closesAt: CLOSES, now: BEFORE_CLOSE },
    );
    expect(result.status).toBe("rejected");
  });

  it("stays open while someone has not answered and the window is live", () => {
    const result = evaluateSplitVote(
      ballots(["a", "yes"], ["b", "no_response"]),
      200000,
      { openedAt: OPENED, closesAt: CLOSES, now: BEFORE_CLOSE },
    );
    expect(result.status).toBe("open");
    expect(result.awaiting).toBe(1);
  });

  it("silence counts as no once the next week has begun", () => {
    const result = evaluateSplitVote(
      ballots(["a", "yes"], ["b", "yes"], ["c", "no_response"]),
      200000,
      { openedAt: OPENED, closesAt: CLOSES, now: AFTER_CLOSE },
    );
    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/non-response counts as no/i);
  });

  it("nobody can be split out by inaction — a silent survivor never yields payouts", () => {
    const result = evaluateSplitVote(
      ballots(["a", "yes"], ["b", "no_response"]),
      200000,
      { openedAt: OPENED, closesAt: CLOSES, now: AFTER_CLOSE },
    );
    expect(result.payouts).toEqual([]);
  });

  it("a lone survivor is an outright win, not a split", () => {
    const result = evaluateSplitVote(ballots(["a", "yes"]), 200000, {
      openedAt: OPENED,
      closesAt: CLOSES,
      now: BEFORE_CLOSE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/outright win/i);
  });

  it("schedules the non-voter reminder 48 hours after opening", () => {
    expect(splitVoteReminderAt(OPENED).toISOString()).toBe("2026-11-12T05:00:00.000Z");
  });
});

describe("final settlement", () => {
  it("one survivor takes the whole pot", () => {
    const result = settleSeason(["a"], 200000, 12, cfg);
    expect(result.kind).toBe("winner");
    if (result.kind === "winner") {
      expect(result.payouts).toEqual([{ entryId: "a", amountCents: 200000 }]);
    }
  });

  it("multiple survivors after Week 18 split evenly", () => {
    const result = settleSeason(["a", "b", "c"], 200000, 18, cfg);
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      expect(result.payouts.reduce((s, p) => s + p.amountCents, 0)).toBe(200000);
      expect(result.reason).toMatch(/splits evenly/i);
    }
  });

  it("multiple survivors before Week 18 keep playing", () => {
    const result = settleSeason(["a", "b", "c"], 200000, 9, cfg);
    expect(result.kind).toBe("in_progress");
  });

  it("zero survivors requires a commissioner ruling rather than guessing", () => {
    const result = settleSeason([], 200000, 14, cfg);
    expect(result.kind).toBe("no_survivors");
    if (result.kind === "no_survivors") {
      expect(result.reason).toMatch(/ruling required/i);
    }
  });

  it("the winner path never loses a cent, at any pot size", () => {
    for (const pot of [0, 1, 13, 200001]) {
      const result = settleSeason(["solo"], pot, 18, cfg);
      if (result.kind === "winner") {
        expect(result.payouts[0]?.amountCents).toBe(pot);
      }
    }
  });
});

describe("negotiated (unequal) splits (D19b)", () => {
  const survivors = ["dave", "mike", "tim"];
  const POT = 200000; // $2,000

  /**
   * The commissioner's real scenario: three left, one wants to keep playing.
   * The two who want out pay him $20 each to agree to stop.
   */
  const boughtOff: SplitProposal = {
    id: "p1",
    proposedByEntryId: "mike",
    proposedAt: OPENED,
    allocations: [
      { entryId: "dave", amountCents: 70667 }, // equal share + $40
      { entryId: "mike", amountCents: 64667 }, // equal share - $20
      { entryId: "tim", amountCents: 64666 }, // equal share - $20
    ],
    note: "Dave gets $20 each from Mike and Tim to stop playing.",
  };

  it("accepts an unequal allocation when everyone agrees", () => {
    const result = evaluateSplitVote(
      ballots(["dave", "yes"], ["mike", "yes"], ["tim", "yes"]),
      POT,
      { openedAt: OPENED, closesAt: CLOSES, now: BEFORE_CLOSE },
      boughtOff,
    );
    expect(result.status).toBe("accepted");
    expect(result.payouts).toEqual(boughtOff.allocations);
    expect(result.reason).toMatch(/Dave gets \$20 each/);
  });

  it("the negotiated allocation still balances to the cent", () => {
    expect(boughtOff.allocations.reduce((s, a) => s + a.amountCents, 0)).toBe(POT);
    expect(validateSplitProposal(boughtOff, survivors, POT)).toEqual([]);
  });

  it("still requires unanimity — the bought-off player can refuse", () => {
    const result = evaluateSplitVote(
      ballots(["dave", "no"], ["mike", "yes"], ["tim", "yes"]),
      POT,
      { openedAt: OPENED, closesAt: CLOSES, now: BEFORE_CLOSE },
      boughtOff,
    );
    expect(result.status).toBe("rejected");
    expect(result.payouts).toEqual([]);
  });

  it("rejects a proposal that does not sum to the pot", () => {
    const short = { ...boughtOff, allocations: [{ entryId: "dave", amountCents: 100 }] };
    const problems = validateSplitProposal(short, survivors, POT);
    expect(problems.map((p) => p.code)).toContain("does_not_balance");
  });

  it("rejects a proposal that omits a living survivor", () => {
    const omits = {
      ...boughtOff,
      allocations: [
        { entryId: "mike", amountCents: 100000 },
        { entryId: "tim", amountCents: 100000 },
      ],
    };
    const problems = validateSplitProposal(omits, survivors, POT);
    expect(problems.map((p) => p.code)).toContain("missing_survivor");
  });

  it("rejects paying someone who is already eliminated", () => {
    const outsider = {
      ...boughtOff,
      allocations: [...boughtOff.allocations, { entryId: "ghost", amountCents: 0 }],
    };
    const problems = validateSplitProposal(outsider, survivors, POT);
    expect(problems.map((p) => p.code)).toContain("unknown_recipient");
  });

  it("rejects negative allocations", () => {
    const negative = {
      ...boughtOff,
      allocations: [
        { entryId: "dave", amountCents: 210000 },
        { entryId: "mike", amountCents: -5000 },
        { entryId: "tim", amountCents: -5000 },
      ],
    };
    const problems = validateSplitProposal(negative, survivors, POT);
    expect(problems.map((p) => p.code)).toContain("negative_amount");
  });

  it("allows a survivor to take $0 if they consent to it", () => {
    const zeroed: SplitProposal = {
      ...boughtOff,
      id: "p2",
      allocations: [
        { entryId: "dave", amountCents: 200000 },
        { entryId: "mike", amountCents: 0 },
        { entryId: "tim", amountCents: 0 },
      ],
      note: "Mike and Tim concede.",
    };
    expect(validateSplitProposal(zeroed, survivors, POT)).toEqual([]);
  });

  it("refuses to settle a malformed proposal even if everyone said yes", () => {
    const broken = { ...boughtOff, allocations: [{ entryId: "dave", amountCents: 1 }] };
    const result = evaluateSplitVote(
      ballots(["dave", "yes"], ["mike", "yes"], ["tim", "yes"]),
      POT,
      { openedAt: OPENED, closesAt: CLOSES, now: BEFORE_CLOSE },
      broken,
    );
    expect(result.status).toBe("invalid_proposal");
    expect(result.payouts).toEqual([]);
  });
});

describe("editing a proposal voids prior consents (D19b)", () => {
  const POT = 200000;

  it("a yes given to an earlier proposal does not carry to a revised one", () => {
    const revised: SplitProposal = {
      id: "p2",
      proposedByEntryId: "mike",
      proposedAt: OPENED,
      allocations: [
        { entryId: "dave", amountCents: 80000 },
        { entryId: "mike", amountCents: 60000 },
        { entryId: "tim", amountCents: 60000 },
      ],
      note: "Revised: Dave's cut increased.",
    };

    // Everyone said yes — but two of them were agreeing to proposal p1.
    const stale = [
      { entryId: "dave", response: "yes" as const, proposalId: "p2" },
      { entryId: "mike", response: "yes" as const, proposalId: "p1" },
      { entryId: "tim", response: "yes" as const, proposalId: "p1" },
    ];

    const result = evaluateSplitVote(stale, POT, {
      openedAt: OPENED,
      closesAt: CLOSES,
      now: BEFORE_CLOSE,
    }, revised);

    expect(result.status).toBe("open");
    expect(result.yes).toBe(1);
    expect(result.awaiting).toBe(2);
    expect(result.payouts).toEqual([]);
  });

  it("settles once everyone has consented to the current proposal", () => {
    const proposal = equalSplitProposal("p3", "dave", OPENED, ["dave", "mike"], POT);
    const result = evaluateSplitVote(
      [
        { entryId: "dave", response: "yes", proposalId: "p3" },
        { entryId: "mike", response: "yes", proposalId: "p3" },
      ],
      POT,
      { openedAt: OPENED, closesAt: CLOSES, now: BEFORE_CLOSE },
      proposal,
    );
    expect(result.status).toBe("accepted");
    expect(result.payouts.reduce((s, p) => s + p.amountCents, 0)).toBe(POT);
  });
});
