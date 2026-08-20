import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason, entryForUser, weekLabel } from "@/lib/season";
import { inLeagueTime, lineLabel, loadSlate, loadedWeeks } from "@/lib/slate";
import { capturedAgo, lineVisibility } from "@/rules/lines";
import { WeekNav } from "./week-nav";
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
  const currentWeek = season.currentWeek ?? 1;
  const weekNumber = Number(week ?? currentWeek);
  const slate = await loadSlate(season.id, weekNumber, season.config);
  const available = await loadedWeeks(season.id);

  if (!slate) {
    return (
      <>
        <h1>{weekLabel(season.seasonType, weekNumber)}</h1>
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
          <h1>{weekLabel(season.seasonType, slate.weekNumber)}</h1>
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

      <WeekNav
        seasonType={season.seasonType}
        current={weekNumber}
        available={available}
        currentWeek={currentWeek}
      />

      {season.seasonType === 1 ? (
        <div className="card callout-warning">
          <p style={{ margin: 0 }}>
            <strong>This is a preseason dress rehearsal.</strong> These are exhibition games and no
            money is involved. Everything else behaves exactly as it will in the real season —
            deadlines, locks, no-reuse, default picks and results all apply.
          </p>
        </div>
      ) : null}

      {!canPick ? (
        // Say which of the two things is actually wrong. "No entry in this
        // season" and "entry awaiting payment" have different fixes, and a
        // practice season has no payment to wait on at all.
        <div className="card callout-warning">
          {!entry ? (
            <p style={{ margin: 0 }}>
              <strong>You are not in this season.</strong> Your account is fine — you just have no
              entry in {season.name}, so nothing here is selectable.{" "}
              {user.isAdmin
                ? "Enroll yourself from commissioner tools, or re-run the preseason script, which now enrolls real accounts automatically."
                : "Ask the commissioner to add you."}
            </p>
          ) : season.mode === "practice" ? (
            <p style={{ margin: 0 }}>
              <strong>Your entry is not active.</strong> This is a free rehearsal, so there is
              nothing to pay — ask the commissioner to activate you.
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              <strong>Your picks will not count yet.</strong> Your entry becomes active once the
              commissioner confirms your payment. See{" "}
              <Link href="/dashboard">your dashboard</Link> for how to pay.
            </p>
          )}
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

      {weekNumber === currentWeek && !slate.linesLockedAt ? (
        <p className="muted">
          Spreads below are the most recent captured, <strong>not yet locked</strong> by the
          commissioner. They are informational and never decide whether a pick survives.
        </p>
      ) : null}

      <ol className="slate">
        {slate.games.map((game) => {
          const locked = now >= game.lockAt;
          const line = lineLabel(game);
          const visibility = lineVisibility({
            weekNumber,
            currentWeek,
            kickoff: game.kickoff,
            now,
            hasLine: line !== null,
          });
          const showLine = visibility === "show";

          return (
            <li key={game.id} className="matchup matchup-pickable">
              <div className="matchup-header">
                <span className="muted">{inLeagueTime(game.kickoff, season.config)}</span>
                {showLine ? (
                  <span className="line-chip" title={`${game.lineProvider ?? "provider"} line`}>
                    {line}
                    {game.lineIsLocked ? null : <span className="line-unlocked"> (not locked)</span>}
                  </span>
                ) : null}
                {showLine && game.lineCapturedAt ? (
                  <span className="muted line-age">as of {capturedAgo(game.lineCapturedAt, now)}</span>
                ) : null}
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
                      // When the entry itself is the blocker, every team is off
                      // limits and none of them is the reason. Saying
                      // "Unavailable" on all 32 reads as a broken schedule.
                      entryBlocked={!canPick}
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
