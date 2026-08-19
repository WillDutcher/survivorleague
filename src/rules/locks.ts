/**
 * Pick deadlines and locking (PROJECT_BRIEF; D17d).
 *
 * A pick locks at   min(kickoff - earlyGameLockLeadMinutes, Sunday deadline).
 *
 * That single expression covers both league rules: a Thursday or Saturday game
 * locks 5 minutes before its own kickoff, while a Sunday-afternoon, Sunday-night
 * or Monday game locks at the normal 12:55 PM ET Sunday deadline.
 *
 * In a multi-pick week each pick locks independently (D17d). Verified to leak no
 * information advantage: if an early pick lost, the entry is already out
 * regardless of later picks; if it won or tied, every remaining pick must still
 * win. The optimal later choice is identical in all branches.
 *
 * Enforcement is a data property, not a scheduling one: legality is decided by
 * comparing the server clock to a stored lock instant. No job has to fire on
 * time for a deadline to hold.
 */

import type { SeasonConfig } from "./config";

const MINUTE_MS = 60_000;

/**
 * Offset of `timeZone` from UTC at a given instant, in milliseconds.
 * DST-correct without a dependency, via the Intl database.
 */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const f: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") f[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    f.year ?? 1970,
    (f.month ?? 1) - 1,
    f.day ?? 1,
    (f.hour ?? 0) % 24, // Intl can render midnight as hour 24
    f.minute ?? 0,
    f.second ?? 0,
  );
  return asUtc - date.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` to an absolute instant.
 * Two passes so that times near a DST transition resolve correctly.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = timeZoneOffsetMs(new Date(naive), timeZone);
  const candidate = new Date(naive - firstPass);
  const secondPass = timeZoneOffsetMs(candidate, timeZone);
  return secondPass === firstPass ? candidate : new Date(naive - secondPass);
}

/**
 * The normal Sunday deadline instant for a week, given that week's Sunday date
 * in league-local terms. Stored on the week record during schedule sync so it is
 * inspectable and overridable by the commissioner.
 */
export function sundayDeadlineFor(
  year: number,
  month: number,
  day: number,
  config: SeasonConfig,
): Date {
  return zonedTimeToUtc(
    year,
    month,
    day,
    config.sundayDeadline.hour,
    config.sundayDeadline.minute,
    config.timezone,
  );
}

/** When a pick on this game stops being editable. */
export function lockTimeFor(kickoff: Date, sundayDeadlineAt: Date, config: SeasonConfig): Date {
  const earlyLock = new Date(kickoff.getTime() - config.earlyGameLockLeadMinutes * MINUTE_MS);
  return earlyLock.getTime() < sundayDeadlineAt.getTime() ? earlyLock : sundayDeadlineAt;
}

export function isEditable(lockAt: Date, now: Date): boolean {
  return now.getTime() < lockAt.getTime();
}

/**
 * A week officially begins at the earliest kickoff on its schedule (D19a).
 * Never hardcode Thursday: the 2026 season has a Wednesday game, and
 * international and holiday games shift this routinely.
 */
export function weekStartsAt(kickoffs: readonly Date[]): Date | null {
  if (kickoffs.length === 0) return null;
  return new Date(Math.min(...kickoffs.map((k) => k.getTime())));
}
