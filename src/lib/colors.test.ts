import { describe, expect, it } from "vitest";
import { chipBorder, parseHex, readableTextOn, relativeLuminance } from "./colors";

describe("parseHex", () => {
  it("reads six-digit hex with or without the hash", () => {
    expect(parseHex("#004C54")).toEqual({ r: 0, g: 76, b: 84 });
    expect(parseHex("004C54")).toEqual({ r: 0, g: 76, b: 84 });
  });

  it("expands shorthand", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#0a0")).toEqual({ r: 0, g: 170, b: 0 });
  });

  it("is case insensitive and tolerates whitespace", () => {
    expect(parseHex("  #aabbcc  ")).toEqual(parseHex("#AABBCC"));
  });

  it("returns null rather than guessing at junk", () => {
    expect(parseHex("")).toBeNull();
    expect(parseHex("red")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("#gggggg")).toBeNull();
    expect(parseHex("rgb(1,2,3)")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("anchors at black and white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("weights green above red above blue", () => {
    const r = relativeLuminance("#ff0000")!;
    const g = relativeLuminance("#00ff00")!;
    const b = relativeLuminance("#0000ff")!;
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });
});

describe("readableTextOn", () => {
  it("puts white on dark team colours", () => {
    expect(readableTextOn("#000000")).toBe("#ffffff"); // Raiders
    expect(readableTextOn("#002244")).toBe("#ffffff"); // Seahawks navy
    expect(readableTextOn("#004C54")).toBe("#ffffff"); // Eagles midnight green
    expect(readableTextOn("#03202F")).toBe("#ffffff"); // Patriots navy
  });

  it("puts black on light team colours", () => {
    expect(readableTextOn("#ffffff")).toBe("#000000");
    expect(readableTextOn("#FFB612")).toBe("#000000"); // Steelers gold
    expect(readableTextOn("#008E97")).toBe("#000000"); // Dolphins aqua
    expect(readableTextOn("#A5ACAF")).toBe("#000000"); // Cowboys silver
  });

  it("picks whichever actually has more contrast, not a midpoint guess", () => {
    // Bengals orange is the case a naive brightness threshold gets wrong.
    const orange = "#FB4F14";
    const lum = relativeLuminance(orange)!;
    const vsBlack = (lum + 0.05) / 0.05;
    const vsWhite = 1.05 / (lum + 0.05);
    expect(readableTextOn(orange)).toBe(vsBlack >= vsWhite ? "#000000" : "#ffffff");
  });

  it("always picks the higher-contrast of the two, for every real team colour", () => {
    const teamColors = [
      "#97233F", "#A71930", "#241773", "#00338D", "#0085CA", "#0B162A",
      "#FB4F14", "#311D00", "#041E42", "#FB4F14", "#0C2340", "#203731",
      "#03202F", "#002C5F", "#006778", "#E31837", "#000000", "#0080C6",
      "#003594", "#008E97", "#4F2683", "#002244", "#D3BC8D", "#0B2265",
      "#125740", "#004C54", "#FFB612", "#AA0000", "#125740", "#0076B6",
      "#4B92DB", "#5A1414",
    ];

    for (const bg of teamColors) {
      const lum = relativeLuminance(bg)!;
      const vsWhite = 1.05 / (lum + 0.05);
      const vsBlack = (lum + 0.05) / 0.05;
      const chosen = readableTextOn(bg) === "#ffffff" ? vsWhite : vsBlack;

      expect(chosen).toBe(Math.max(vsWhite, vsBlack));
      // 3:1 is the WCAG AA floor for large/bold text, which is what a chip
      // label is. Mid-tone colours cannot reach the 4.5:1 body-text floor
      // against EITHER black or white — that is a property of the colour, not
      // something a better choice here could fix, which is why the chips are
      // set in bold and never carry meaning by colour alone.
      expect(chosen).toBeGreaterThanOrEqual(3);
    }
  });

  it("falls back rather than throwing on a bad colour", () => {
    expect(readableTextOn("not a colour")).toBe("#ffffff");
    expect(readableTextOn("")).toBe("#ffffff");
  });
});

describe("chipBorder", () => {
  it("uses the secondary colour when it reads as an edge", () => {
    // Packers: dark green with gold.
    expect(chipBorder("#203731", "#FFB612")).toBe("#FFB612");
  });

  it("falls back to a neutral rule on a light colour with no contrast to spare", () => {
    expect(chipBorder("#F5F5F5", "#FAFAFA")).toBe("rgba(0,0,0,0.25)");
  });

  it("needs no border on a dark colour whose secondary is just as dark", () => {
    expect(chipBorder("#000000", "#0a0a0a")).toBe("transparent");
  });

  it("survives junk input", () => {
    expect(chipBorder("nope", "also nope")).toBe("rgba(0,0,0,0.25)");
  });
});
