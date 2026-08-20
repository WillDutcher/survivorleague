/**
 * Text contrast against team colours.
 *
 * The 32 primary colours run from Bengals orange to Raiders black, so a fixed
 * text colour is unreadable on roughly half of them. This picks black or white
 * per colour using the WCAG relative-luminance formula rather than a naive
 * brightness threshold — the naive version gets mid-tone colours wrong, and
 * several teams sit exactly there.
 *
 * Contrast is a legibility floor, never the carrier of meaning: the team
 * abbreviation is always present as text (D31).
 */

/** sRGB -> linear, the gamma step WCAG requires before luminance. */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parses #rgb, #rrggbb, or bare rrggbb. Returns null on anything else. */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, "");

  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;

  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two luminances, 1:1 to 21:1. */
function ratio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Black or white, whichever is more readable on this background.
 *
 * Unparseable colours fall back to white on the assumption the caller is about
 * to paint an unknown background — a wrong guess here is a legibility problem,
 * and white-on-unknown is the safer of the two because the surrounding UI is
 * light and an unstyled chip stays readable.
 */
export function readableTextOn(background: string): "#000000" | "#ffffff" {
  const lum = relativeLuminance(background);
  if (lum === null) return "#ffffff";
  // ratio(lum, 1) is the contrast against WHITE text; if that wins, use white.
  return ratio(lum, 1) >= ratio(lum, 0) ? "#ffffff" : "#000000";
}

/**
 * A border colour for a chip painted in `background`.
 *
 * Very light team colours (Dolphins aqua, Chargers powder blue) vanish against
 * a white card without one. The secondary colour is used when it is distinct
 * enough to read as an edge, otherwise a neutral rule.
 */
export function chipBorder(background: string, secondary: string): string {
  const bg = relativeLuminance(background);
  const sec = relativeLuminance(secondary);
  if (bg === null) return "rgba(0,0,0,0.25)";
  if (sec !== null && ratio(bg, sec) >= 1.6) return secondary;
  return bg > 0.6 ? "rgba(0,0,0,0.25)" : "transparent";
}
