import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason, entryForUser } from "@/lib/season";
import { inLeagueTime, lineLabel, loadSlate } from "@/lib/slate";
import { availabilityFor, loadEntryPickContext } from "@/lib/picks";
import { TeamBadge } from "@/app/team-badge";
import { PickButton } from "./pick-button";
import type { Game } from "@/rules/types";

export const dynamic = "force-dynamic";

/**
 * The weekly pick screen.
 *
 * Every team that is legal for this entry is selectable; every team that is not
 * is disabled with a stated reason. Nothing here decides legality — the rule
 * engine does, and the same decision is re-made server-side when a pick is
 * submitted, so a manipulated page cannot produce an illegal pick.
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
  const entry = await entryForUser(user.id, season.id);
  const context = entry
    ? await loadEntryPickContext(entry.id, season.id, weekNumber, now)
    : null;

  const weekGames: Game[] = slate.games.map((g) => ({
    id: g.id,
    week: weekNumber,
    awayTeamId: g.away.id,
    homeTeamId: g.home.id,
    kickoff: g.kickoff,
    status: g.status as Game["status"],
    awayScore: g.awayScore,
    homeScore: g.homeScore,
  }));

  const lockAtByGameId = new Map(slate.games.map((g) => [g.id, g.lockAt]));
  const availability = context
    ? availabilityFor(context, weekGames, lockAtByGameId, now)
    : [];
  const availabilityByTeam = new Map(availability.map((a) => [a.teamId, a]));

  const selectedTeams = new Set(context?.currentWeekPicks.map((p) => p.teamId) ?? []);
  const required = context?.entry.requiredPicks ?? 1;
  const canPick = entry?.status === "active";
  const picksMade = context?.currentWeekPicks.length ?? 0;

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

      {!canPick ? (
        <div className="card callout-warning">
          <p style={{ margin: 0 }}>
            <strong>Your picks will not count yet.</strong> Your entry becomes active once the
            commissioner confirms your payment. See{" "}
            <Link href="/dashboard">your dashboard</Link> for how to pay.
          </p>
        </div>
      ) : (
        <div className="card">
          <p style={{ margin: 0 }}>
            {required > 1 ? (
              <>
                <strong>You tied, so this week needs {required} winning picks.</strong> You have
                chosen {picksMade} of {required}. Every one of them must win — a single loss ends
                your entry.
              </>
            ) : picksMade > 0 ? (
              <>
                <span className="status-ok"> Your pick is in.</span> You can change it until it
                locks.
              </>
            ) : (
              <>
                <strong>No pick yet for this week.</strong> Choose a team below. If you miss the
                deadline, the strongest available favourite is assigned automatically.
              </>
            )}
          </p>
        </div>
      )}

      {!slate.linesLockedAt ? (
        <p className="muted">
          Point spreads have not been locked for this week, so no lines are shown. Spreads are
          informational and never decide whether a pick survives.
        </p>
      ) : null}

      <ol className="slate">
        {slate.games.map((game) => {
          const locked = now >= game.lockAt;
          const line = lineLabel(game);

          return (
            <li key={game.id} className="matchup matchup-pickable">
              <div className="matchup-header">
                <span className="muted">{inLeagueTime(game.kickoff, season.config)}</span>
                {line ? <span className="line-chip">{line}</span> : null}
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

              <div className="matchup-picks">
                {[game.away, game.home].map((team) => {
                  const info = availabilityByTeam.get(team.id);
                  const selected = selectedTeams.has(team.id);
                  const unavailable = Boolean(info && !info.available);

                  return (
                    <PickButton
                      key={team.id}
                      team={team}
                      weekNumber={weekNumber}
                      showLogo={season.showTeamLogos}
                      selected={selected}
                      disabled={!canPick || (unavailable && !selected)}
                      reason={unavailable && !selected ? (info?.explanation ?? null) : null}
                      locked={locked}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      {context && context.entry.committedTeamIds.length > 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Teams you have used</h2>
          <p className="muted">
            These are gone for the rest of the season. A rebuy never gives them back.
          </p>
          <ul className="used-teams">
            {[...context.committedInWeek.entries()]
              .sort((a, b) => a[1] - b[1])
              .map(([teamId, usedWeek]) => (
                <li key={teamId}>
                  <TeamBadge
                    team={
                      slate.games
                        .flatMap((g) => [g.away, g.home])
                        .find((t) => t.id === teamId) ?? {
                        id: teamId,
                        city: "",
                        name: teamId,
                        colorPrimary: "#555",
                        colorSecondary: "#fff",
                        logoUrl: null,
                      }
                    }
                    showLogo={season.showTeamLogos}
                    size={22}
                  />
                  <span className="muted">Week {usedWeek}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
