/**
 * When a point spread is worth showing a player.
 *
 * Spreads are informational (D16) — they never decide survival — so this is
 * purely about not showing a number that is misleading or absent. Four cases
 * where a line does more harm than good:
 *
 *   PAST WEEK      the week is decided; the result is the fact, the line is noise
 *   ALREADY KICKED the line described a game that is now under way
 *   TOO FAR AHEAD  books have not set it; rendering it means rendering blanks
 *   NO LINE        nothing was captured, and inventing one is forbidden (D10)
 *
 * Deliberately shows lines for the CURRENT week only. Books do sometimes post
 * next week's numbers early, but a line a player sees days before the games are
 * finalized invites decisions on numbers that will move a lot.
 */

export type LineVisibility =
  | "show"
  | "hidden_past_week"
  | "hidden_kicked_off"
  | "hidden_future_week"
  | "hidden_no_line";

export interface LineVisibilityInput {
  weekNumber: number;
  currentWeek: number;
  kickoff: Date;
  now: Date;
  hasLine: boolean;
}

export function lineVisibility(input: LineVisibilityInput): LineVisibility {
  const { weekNumber, currentWeek, kickoff, now, hasLine } = input;

  if (weekNumber < currentWeek) return "hidden_past_week";
  if (weekNumber > currentWeek) return "hidden_future_week";
  if (now.getTime() >= kickoff.getTime()) return "hidden_kicked_off";
  if (!hasLine) return "hidden_no_line";
  return "show";
}

/** Why a line is not being shown, for the UI. Null when it is shown. */
export function lineHiddenReason(visibility: LineVisibility): string | null {
  switch (visibility) {
    case "show":
      return null;
    case "hidden_past_week":
      return "This week is over — the result is what matters now.";
    case "hidden_kicked_off":
      return "Game has started.";
    case "hidden_future_week":
      return "Lines for this week have not been set yet.";
    case "hidden_no_line":
      return "No line captured for this game.";
  }
}

/**
 * How stale a captured line is, in plain words.
 *
 * Shown alongside every line so players can judge it for themselves rather than
 * assuming what they see is live. It is never live — it is whatever was captured
 * at the last sync.
 */
export function capturedAgo(capturedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - capturedAt.getTime()) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
