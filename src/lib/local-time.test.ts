import { describe, expect, it } from "vitest";
import { isAtOrAfterLocal, localTimeIn } from "./local-time";

const ET = "America/New_York";

describe("localTimeIn", () => {
  it("reads Eastern daylight time correctly", () => {
    // 17:00 UTC on a September Sunday is 1:00 PM EDT.
    const t = localTimeIn(ET, new Date("2026-09-13T17:00:00Z"));
    expect(t).toEqual({ hour: 13, minute: 0, weekday: "Sun" });
  });

  it("reads Eastern standard time correctly", () => {
    // The SAME 17:00 UTC in December is only NOON in Eastern.
    const t = localTimeIn(ET, new Date("2026-12-13T17:00:00Z"));
    expect(t).toEqual({ hour: 12, minute: 0, weekday: "Sun" });
  });

  it("normalises midnight to hour 0, never 24", () => {
    // 05:00 UTC in January is midnight Eastern.
    expect(localTimeIn(ET, new Date("2026-01-05T05:00:00Z")).hour).toBe(0);
  });

  it("crosses the date line back to the previous local day", () => {
    // Tuesday 03:59 UTC is still MONDAY night in Eastern.
    const t = localTimeIn(ET, new Date("2026-09-15T03:59:00Z"));
    expect(t.weekday).toBe("Mon");
    expect(t.hour).toBe(23);
  });
});

describe("isAtOrAfterLocal — the Sunday 1 PM digest guard", () => {
  // Both UTC times are scheduled because cron cannot express "1 PM Eastern".
  // The guard is what stops the wrong one from acting.
  const EDT_FIRING = new Date("2026-09-13T17:00:00Z"); // 1:00 PM EDT
  const EST_FIRING = new Date("2026-12-13T18:00:00Z"); // 1:00 PM EST

  it("fires at 1 PM during daylight time", () => {
    expect(isAtOrAfterLocal(ET, EDT_FIRING, 13)).toBe(true);
  });

  it("fires at 1 PM during standard time", () => {
    expect(isAtOrAfterLocal(ET, EST_FIRING, 13)).toBe(true);
  });

  it("REFUSES the 17:00 UTC firing in winter, when it is only noon", () => {
    // This is the bug the guard exists for: without it, the digest would go out
    // at 12:00 — before the 12:55 deadline — announcing locked picks that are
    // not locked.
    expect(isAtOrAfterLocal(ET, new Date("2026-12-13T17:00:00Z"), 13)).toBe(false);
  });

  it("allows the later twin in summer, which the run key then dedupes", () => {
    // 18:00 UTC in September is 2 PM EDT: past 1 PM, so the guard permits it.
    // Preventing the double send is the run key's job, not the clock's.
    expect(isAtOrAfterLocal(ET, new Date("2026-09-13T18:00:00Z"), 13)).toBe(true);
  });
});

describe("isAtOrAfterLocal — the Monday 11:59 PM recap guard", () => {
  it("fires at 11:59 PM Monday during daylight time", () => {
    // Tuesday 03:59 UTC = Monday 23:59 EDT.
    const t = new Date("2026-09-15T03:59:00Z");
    expect(localTimeIn(ET, t).weekday).toBe("Mon");
    expect(isAtOrAfterLocal(ET, t, 23)).toBe(true);
  });

  it("fires at 11:59 PM Monday during standard time", () => {
    // Tuesday 04:59 UTC = Monday 23:59 EST.
    const t = new Date("2026-12-15T04:59:00Z");
    expect(localTimeIn(ET, t).weekday).toBe("Mon");
    expect(isAtOrAfterLocal(ET, t, 23)).toBe(true);
  });

  it("REFUSES the winter-timed firing in summer, when Monday is already over", () => {
    // 04:59 UTC in September is 12:59 AM TUESDAY — the week has turned over and
    // sending then would recap under the wrong week label.
    const t = new Date("2026-09-15T04:59:00Z");
    expect(localTimeIn(ET, t).weekday).toBe("Tue");
    expect(isAtOrAfterLocal(ET, t, 23)).toBe(false);
  });

  it("REFUSES the summer-timed firing in winter, when it is only 10:59 PM", () => {
    const t = new Date("2026-12-15T03:59:00Z");
    expect(localTimeIn(ET, t).hour).toBe(22);
    expect(isAtOrAfterLocal(ET, t, 23)).toBe(false);
  });
});

describe("isAtOrAfterLocal — minutes", () => {
  it("respects the minute when the hour matches", () => {
    const t = new Date("2026-09-13T16:54:00Z"); // 12:54 PM EDT
    expect(isAtOrAfterLocal(ET, t, 12, 55)).toBe(false);
    expect(isAtOrAfterLocal(ET, new Date("2026-09-13T16:55:00Z"), 12, 55)).toBe(true);
  });

  it("is true for any later hour regardless of minute", () => {
    expect(isAtOrAfterLocal(ET, new Date("2026-09-13T18:00:00Z"), 12, 55)).toBe(true);
  });
});
