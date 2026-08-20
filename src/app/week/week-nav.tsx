import Link from "next/link";
import { weekLabel } from "@/rules/weeks";

/**
 * Week navigation.
 *
 * Server-rendered links rather than a client picker: each week is a real URL,
 * so it can be bookmarked, shared, and opened in a new tab. A dropdown that
 * only worked with JavaScript would be worse on a phone at 12:50 on a Sunday.
 */
export function WeekNav({
  seasonType,
  current,
  available,
  currentWeek,
}: {
  seasonType: number;
  current: number;
  available: number[];
  currentWeek: number;
}) {
  if (available.length <= 1) return null;

  const index = available.indexOf(current);
  const prev = index > 0 ? (available[index - 1] ?? null) : null;
  const next =
    index >= 0 && index < available.length - 1 ? (available[index + 1] ?? null) : null;

  return (
    <nav className="week-nav" aria-label="Week">
      {prev !== null ? (
        <Link href={`/week?week=${prev}`} rel="prev">
          ← {weekLabel(seasonType, prev)}
        </Link>
      ) : (
        <span className="muted">←</span>
      )}

      <ol className="week-pips">
        {available.map((w) => (
          <li key={w}>
            <Link
              href={`/week?week=${w}`}
              aria-current={w === current ? "page" : undefined}
              className={[
                "week-pip",
                w === current ? "is-current" : "",
                w === currentWeek ? "is-live" : "",
                w < currentWeek ? "is-past" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={weekLabel(seasonType, w) + (w === currentWeek ? " — current week" : "")}
            >
              {seasonType === 1 && w <= 1 ? "HOF" : seasonType === 1 ? w - 1 : w}
            </Link>
          </li>
        ))}
      </ol>

      {next !== null ? (
        <Link href={`/week?week=${next}`} rel="next">
          {weekLabel(seasonType, next)} →
        </Link>
      ) : (
        <span className="muted">→</span>
      )}
    </nav>
  );
}
