/**
 * Week naming.
 *
 * ESPN's PRESEASON week numbers are offset by one from the labels the NFL shows,
 * because API week 1 is the Hall of Fame game. API weeks 2, 3 and 4 are what
 * everyone else calls Preseason Weeks 1, 2 and 3.
 *
 * The API number is what gets stored and synced; translation happens only at
 * display time. Otherwise players see "Week 3" while NFL.com says "PRE WK 2" for
 * the same games, which is exactly the kind of small wrongness that makes people
 * distrust the whole thing.
 */

/** Preseason is API weeks 1-4: the Hall of Fame game plus three weeks. */
export const PRESEASON_LAST_API_WEEK = 4;

export function weekLabel(seasonType: number, weekNumber: number): string {
  if (seasonType !== 1) return `Week ${weekNumber}`;
  if (weekNumber <= 1) return "Hall of Fame Game";
  return `Preseason Week ${weekNumber - 1}`;
}

/** Short form for tight spaces, e.g. pick-history chips. */
export function weekLabelShort(seasonType: number, weekNumber: number): string {
  if (seasonType !== 1) return `W${weekNumber}`;
  if (weekNumber <= 1) return "HOF";
  return `PRE${weekNumber - 1}`;
}
