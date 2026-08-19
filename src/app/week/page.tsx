import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason } from "@/lib/season";
import { inLeagueTime, lineLabel, loadSlate } from "@/lib/slate";
import { TeamBadge } from "@/app/team-badge";

export const dynamic = "force-dynamic";

/**
 * The week's slate.
 *
 * Read-only for now — pick selection lands next. This exists so the matchup
 * layout, team display, and lock times can be seen and judged against real data.
 */
export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const season = await currentSeason();
  if (!season) redirect("/dashboard");

  const { week } = await searchParams;
  const weekNumber = Number(week ?? season.currentWeek ?? 1);
  const slate = await loadSlate(season.id, weekNumber, season.config);

  if (!slate) {
    return (
      <>
        <h1>Week {weekNumber}</h1>
        <div className="card">
          <p>
            No schedule loaded for this week yet.{" "}
            {user.isAdmin ? (
              <>
                Run a sync from <Link href="/admin">commissioner tools</Link>.
              </>
            ) : (
              "Check back once the commissioner has loaded it."
            )}
          </p>
        </div>
      </>
    );
  }

  const now = new Date();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Week {slate.weekNumber}</h1>
          <p className="muted">
            {slate.games.length} games ·{" "}
            {slate.sundayDeadlineAt ? (
              <>Deadline {inLeagueTime(slate.sundayDeadlineAt, season.config)}</>
            ) : (
              "Deadline not set"
            )}
          </p>
        </div>
        <Link href="/dashboard">Back to dashboard</Link>
      </div>

      {!slate.linesLockedAt ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Point spreads for this week have not been locked yet, so no lines are shown. Spreads are
            informational and never decide whether a pick survives.
          </p>
        </div>
      ) : null}

      <ol className="slate">
        {slate.games.map((game) => {
          const locked = now >= game.lockAt;
          const line = lineLabel(game);

          return (
            <li key={game.id} className="matchup">
              <div className="matchup-teams">
                <TeamBadge team={game.away} showLogo={season.showTeamLogos} showFullName />
                <span className="matchup-at" aria-label="at">
                  @
                </span>
                <TeamBadge team={game.home} showLogo={season.showTeamLogos} showFullName />
              </div>

              <div className="matchup-meta">
                <span>{inLeagueTime(game.kickoff, season.config)}</span>
                {line ? <span className="line-chip">{line}</span> : null}
                {/* Lock state is stated in words, never by colour alone. */}
                <span className={locked ? "status-bad" : "status-ok"}>
                  {" "}
                  {locked ? "Locked" : `Locks ${inLeagueTime(game.lockAt, season.config)}`}
                </span>
                {game.status === "final" ? (
                  <span>
                    Final: {game.away.id} {game.awayScore} – {game.home.id} {game.homeScore}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
