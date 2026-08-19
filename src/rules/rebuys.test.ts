import { describe, expect, it } from "vitest";
import { SEASON_2026 } from "./config";
import { requiredPicksAfterRebuy, rebuyOptionsFor } from "./rebuys";
import type { EntryState, EntryTier } from "./types";

const cfg = SEASON_2026;

function entry(tier: EntryTier, overrides: Partial<EntryState> = {}): EntryState {
  return {
    id: "e1",
    tier,
    status: "active",
    committedTeamIds: [],
    requiredPicks: 1,
    includedRebuysRemaining: tier === "EIGHTY" ? 3 : 0,
    ...overrides,
  };
}

describe("$20 tier (D20)", () => {
  it("Week 1 loss costs $10", () => {
    const { offers } = rebuyOptionsFor(entry("TWENTY"), 1, cfg);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.kind).toBe("paid");
    expect(offers[0]?.priceCents).toBe(1000);
  });

  it("Weeks 2 through 5 cost $30", () => {
    for (const week of [2, 3, 4, 5]) {
      const { offers } = rebuyOptionsFor(entry("TWENTY"), week, cfg);
      expect(offers[0]?.priceCents, `week ${week}`).toBe(3000);
    }
  });

  it("Week 6 loss ends the entry — no rebuys after Week 5", () => {
    const { offers, ineligibleReason } = rebuyOptionsFor(entry("TWENTY"), 6, cfg);
    expect(offers).toHaveLength(0);
    expect(ineligibleReason).toMatch(/only for losses through Week 5/i);
  });

  it("rebuys are unlimited within the window — a fourth rebuy is still offered", () => {
    // Lost weeks 1, 2, 3 and rebought each time; now loses week 4.
    const veteran = entry("TWENTY", { committedTeamIds: ["PHI", "DAL", "KC", "SF"] });
    const { offers } = rebuyOptionsFor(veteran, 4, cfg);
    expect(offers[0]?.priceCents).toBe(3000);
  });

  it("the $10 price is exclusive to Week 1 and never reappears", () => {
    const laterWeeks = [2, 3, 4, 5].map(
      (w) => rebuyOptionsFor(entry("TWENTY"), w, cfg).offers[0]?.priceCents,
    );
    expect(laterWeeks.every((p) => p === 3000)).toBe(true);
  });

  it("never receives an included rebuy", () => {
    for (const week of [1, 2, 3, 4, 5]) {
      const { offers } = rebuyOptionsFor(entry("TWENTY"), week, cfg);
      expect(offers.every((o) => o.kind === "paid"), `week ${week}`).toBe(true);
    }
  });
});

describe("$80 tier (D20)", () => {
  it("uses an included rebuy for the first three qualifying losses through Week 8", () => {
    for (const remaining of [3, 2, 1]) {
      const { offers } = rebuyOptionsFor(
        entry("EIGHTY", { includedRebuysRemaining: remaining }),
        4,
        cfg,
      );
      expect(offers).toHaveLength(1);
      expect(offers[0]?.kind).toBe("included");
      expect(offers[0]?.priceCents).toBe(0);
    }
  });

  it("a fourth loss has no included rebuy left and nothing is purchasable", () => {
    const spent = entry("EIGHTY", { includedRebuysRemaining: 0 });
    const { offers, ineligibleReason } = rebuyOptionsFor(spent, 4, cfg);
    expect(offers).toHaveLength(0);
    expect(ineligibleReason).toMatch(/cannot be purchased/i);
  });

  it("unused included rebuys EXPIRE after Week 8 — clean sheet, Week 9 loss, out", () => {
    const untouched = entry("EIGHTY", { includedRebuysRemaining: 3 });
    const { offers, ineligibleReason } = rebuyOptionsFor(untouched, 9, cfg);
    expect(offers).toHaveLength(0);
    expect(ineligibleReason).toMatch(/after Week 8/i);
  });

  it("Week 8 is still inside the window", () => {
    const { offers } = rebuyOptionsFor(entry("EIGHTY"), 8, cfg);
    expect(offers).toHaveLength(1);
  });

  it("never offers a purchasable rebuy at any week", () => {
    for (const week of [1, 5, 8, 9, 12]) {
      const { offers } = rebuyOptionsFor(entry("EIGHTY"), week, cfg);
      expect(offers.every((o) => o.kind === "included"), `week ${week}`).toBe(true);
    }
  });
});

describe("rebuy interaction with the tie rule (D17b)", () => {
  it("a rebuy resets the pick requirement to 1", () => {
    // Tied in Week 4, so Week 5 required two; lost one of them, then rebought.
    expect(requiredPicksAfterRebuy(cfg, 2)).toBe(1);
    expect(requiredPicksAfterRebuy(cfg, 4)).toBe(1);
  });

  it("used-team history is not part of rebuy eligibility and is never cleared here", () => {
    const burned = entry("TWENTY", { committedTeamIds: ["PHI", "DAL", "KC"] });
    const { offers } = rebuyOptionsFor(burned, 3, cfg);
    expect(offers).toHaveLength(1);
    // The engine never mutates committed teams; the rebuy path must not reset them.
    expect(burned.committedTeamIds).toEqual(["PHI", "DAL", "KC"]);
  });
});
