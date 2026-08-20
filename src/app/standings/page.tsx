import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason, formatMoney, seasonPotCents } from "@/lib/season";
import { loadStandings, teamsRemaining, type StandingRow } from "@/lib/standings";
import { weekLabel, weekLabelShort } from "@/rules/weeks";

export const dynamic = "force-dynamic";

/**
 * Who is alive, and everything the league can fairly see about them.
 *
 * A player's pick for the current week appears only once its game has kicked
 * off. Until then it shows as made-but-hidden, which is deliberately different
 * from showing nothing — "hasn't picked" and "picked, not revealed" are
 * different facts.
 *
 * The commissioner sees every pick immediately, marked as not-yet-public, so
 * they can chase missing picks and catch bad ones before kickoff.
 */
export default async function StandingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/dashboard");

  const currentWeek = season.currentWeek ?? 1;
  const rows = await loadStandings(season.id, currentWeek, season.config, {
    revealAll: user.isAdmin,
  });
  const pot = await seasonPotCents(season.id);

  const alive = rows.filter((r) => r.status === "active" || r.status === "rebuy_pending");
  const out = rows.filter((r) => r.status === "eliminated" || r.status === "settled");
  const notIn = rows.filter((r) => r.status === "registered" || r.status === "paid");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Standings</h1>
          <p className="muted">
            {season.name} · {weekLabel(season.seasonType, currentWeek)}
          </p>
        </div>
        <Link href="/dashboard">Back to dashboard</Link>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{alive.length}</span>
          <span className="stat-label">Still alive</span>
        </div>
        <div className="stat">
          <span className="stat-value">{out.length}</span>
          <span className="stat-label">Out</span>
        </div>
        {season.mode !== "practice" ? (
          <div className="stat">
            <span className="stat-value">{formatMoney(pot)}</span>
            <span className="stat-label">Pot</span>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Alive</h2>
        {alive.length === 0 ? (
          <p className="muted">Nobody is active yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Rebuys</th>
                  <th scope="col">State</th>
                  <th scope="col">
                    This week
                    <span className="th-note">
                      {user.isAdmin ? "commissioner view — all picks" : "shown once the game starts"}
                    </span>
                  </th>
                  <th scope="col">Teams used</th>
                </tr>
              </thead>
              <tbody>
                {alive.map((row) => (
                  <PlayerRow key={row.entryId} row={row} seasonType={season.seasonType} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {out.length > 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Out</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Eliminated</th>
                  <th scope="col">Teams used</th>
                </tr>
              </thead>
              <tbody>
                {out.map((row) => (
                  <tr key={row.entryId} className="standing-eliminated">
                    <td>{row.name}</td>
                    <td>{row.tierLabel}</td>
                    <td>
                      <span className="status-bad">
                        {" "}
                        {row.status === "settled"
                          ? "Settled"
                          : row.eliminatedAtWeek
                            ? weekLabel(season.seasonType, row.eliminatedAtWeek)
                            : "Eliminated"}
                      </span>
                    </td>
                    <td>
                      <TeamsUsed row={row} seasonType={season.seasonType} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {notIn.length > 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Not in the pool yet</h2>
          <p className="muted">Signed up but payment not confirmed.</p>
          <ul>
            {notIn.map((row) => (
              <li key={row.entryId}>
                {row.name} — <span className="muted">{row.tierLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function PlayerRow({ row, seasonType }: { row: StandingRow; seasonType: number }) {
  return (
    <tr>
      <td>{row.name}</td>
      <td>{row.tierLabel}</td>
      <td className="muted">{row.rebuyLabel}</td>
      <td>
        {row.status === "rebuy_pending" ? (
          <span className="status-bad"> Rebuy pending</span>
        ) : row.requiredPicks > 1 ? (
          <span className="status-bad"> Owes {row.requiredPicks} winners</span>
        ) : (
          <span className="status-ok"> Alive</span>
        )}
        <div className="muted hint">{teamsRemaining(row)} teams left</div>
      </td>
      <td>
        {row.currentPick ? (
          <>
            <strong>{row.currentPick}</strong>
            {/* Only the commissioner reaches this branch: a pick shown while
                still flagged not-public. The note keeps them from repeating it
                to the league. */}
            {row.currentPickHidden ? <div className="hint muted">not public yet</div> : null}
          </>
        ) : row.currentPickHidden ? (
          // Made but not revealed. Saying so is the point: it is not the same
          // as having made no pick.
          <span className="muted">Pick made — hidden until kickoff</span>
        ) : (
          <span className="muted">No pick yet</span>
        )}
      </td>
      <td>
        <TeamsUsed row={row} seasonType={seasonType} />
      </td>
    </tr>
  );
}

/**
 * Teams already used, behind a native <details>.
 *
 * Not a tooltip: tooltips do not exist on a phone, and this is exactly the
 * information someone checks on a phone before picking. <details> is keyboard
 * operable and needs no JavaScript.
 */
function TeamsUsed({ row, seasonType }: { row: StandingRow; seasonType: number }) {
  if (row.history.length === 0) {
    return <span className="muted">—</span>;
  }

  return (
    <details className="teams-used">
      <summary>
        {row.history.length} team{row.history.length === 1 ? "" : "s"}
      </summary>
      <ul className="pick-history">
        {row.history.map((h) => (
          <li key={`${h.week}-${h.teamId}`} className="pick-chip">
            {weekLabelShort(seasonType, h.week)} {h.teamId}
            {h.outcome === "win" ? " ✓" : h.outcome === "loss" ? " ✕" : h.outcome === "tie" ? " =" : ""}
            {h.source === "default" ? " (auto)" : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
