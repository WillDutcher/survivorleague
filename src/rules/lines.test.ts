import { describe, expect, it } from "vitest";
import { capturedAgo, lineHiddenReason, lineVisibility } from "./lines";

const KICKOFF = new Date("2026-09-13T17:00:00Z");
const BEFORE = new Date("2026-09-13T12:00:00Z");
const AFTER = new Date("2026-09-13T18:30:00Z");

function vis(over: Partial<Parameters<typeof lineVisibility>[0]> = {}) {
  return lineVisibility({
    weekNumber: 3,
    currentWeek: 3,
    kickoff: KICKOFF,
    now: BEFORE,
    hasLine: true,
    ...over,
  });
}

describe("lineVisibility", () => {
  it("shows the line for an upcoming game in the current week", () => {
    expect(vis()).toBe("show");
  });

  it("hides lines for weeks already played", () => {
    expect(vis({ weekNumber: 1 })).toBe("hidden_past_week");
    expect(vis({ weekNumber: 2 })).toBe("hidden_past_week");
  });

  it("hides lines for weeks whose numbers are not set yet", () => {
    expect(vis({ weekNumber: 4 })).toBe("hidden_future_week");
    expect(vis({ weekNumber: 10 })).toBe("hidden_future_week");
  });

  it("hides the line once the game has kicked off", () => {
    expect(vis({ now: AFTER })).toBe("hidden_kicked_off");
  });

  it("hides at the exact kickoff instant, not a second later", () => {
    expect(vis({ now: KICKOFF })).toBe("hidden_kicked_off");
    expect(vis({ now: new Date(KICKOFF.getTime() - 1000) })).toBe("show");
  });

  it("hides when nothing was captured rather than inventing a number", () => {
    expect(vis({ hasLine: false })).toBe("hidden_no_line");
  });

  it("prefers the week reason over the kickoff reason for a past week", () => {
    // A past week's games have all kicked off; saying "week is over" is more
    // useful than "game has started".
    expect(vis({ weekNumber: 1, now: AFTER })).toBe("hidden_past_week");
  });

  it("gives a reason for every hidden case and none when shown", () => {
    expect(lineHiddenReason("show")).toBeNull();
    for (const v of [
      "hidden_past_week",
      "hidden_kicked_off",
      "hidden_future_week",
      "hidden_no_line",
    ] as const) {
      expect(lineHiddenReason(v), v).toBeTruthy();
    }
  });
});

describe("capturedAgo", () => {
  const now = new Date("2026-09-13T12:00:00Z");
  const ago = (ms: number) => capturedAgo(new Date(now.getTime() - ms), now);

  it("describes staleness in plain words", () => {
    expect(ago(30_000)).toBe("just now");
    expect(ago(15 * 60_000)).toBe("15 minutes ago");
    expect(ago(60 * 60_000)).toBe("1 hour ago");
    expect(ago(5 * 60 * 60_000)).toBe("5 hours ago");
    expect(ago(24 * 60 * 60_000)).toBe("1 day ago");
    expect(ago(3 * 24 * 60 * 60_000)).toBe("3 days ago");
  });

  it("never reports a negative age if clocks disagree", () => {
    expect(capturedAgo(new Date(now.getTime() + 60_000), now)).toBe("just now");
  });
});
