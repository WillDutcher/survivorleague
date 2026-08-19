import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason, formatMoney, seasonPotCents, weekLabel, weekLabelShort } from "@/lib/season";
import { loadStandings, teamsRemaining } from "@/lib/standings";

export const dynamic = "force-dynamic";

/**
 * Who is alive.
 *
 * Another player's current pick is hidden until it locks, so nobody can shadow
 * someone else's choice. Past picks are open history.
 */
export default async function StandingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/dashboard");

  const currentWeek = season.currentWeek ?? 1;
  const rows = await loadStandings(season.id, currentWeek);
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
        <div className="stat">
          <span className="stat-value">{formatMoney(pot)}</span>
          <span className="stat-label">Pot</span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Alive</h2>
        {alive.length === 0 ? (
          <p className="muted">Nobody is active yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">State</th>
                <th scope="col">Teams left</th>
                <th scope="col">Picks so far</th>
              </tr>
            </thead>
            <tbody>
              {alive.map((row) => (
                <tr key={row.entryId}>
                  <td>{row.name}</td>
                  <td>
                    {row.status === "rebuy_pending" ? (
                      <span className="status-bad"> Rebuy pending</span>
                    ) : row.requiredPicks > 1 ? (
                      <span className="status-bad"> Owes {row.requiredPicks} winners</span>
                    ) : (
                      <span className="status-ok"> Alive</span>
                    )}
                    {row.hasHiddenPick ? (
                      <div className="muted hint">Pick made — hidden until it locks</div>
                    ) : null}
                  </td>
                  <td>{teamsRemaining(row)}</td>
                  <td>
                    <div className="pick-history">
                      {row.history.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        row.history.map((h) => (
                          <span key={`${h.week}-${h.teamId}`} className="pick-chip">
                            {weekLabelShort(season.seasonType, h.week)} {h.teamId}
                            {h.outcome === "win" ? " ✓" : h.outcome === "loss" ? " ✕" : h.outcome === "tie" ? " =" : ""}
                            {h.source === "default" ? " (auto)" : ""}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {out.length > 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Out</h2>
          <table>
            <tbody>
              {out.map((row) => (
                <tr key={row.entryId} className="standing-eliminated">
                  <td>{row.name}</td>
                  <td>
                    <span className="status-bad">
                      {" "}
                      {row.status === "settled" ? "Settled" : `Eliminated week ${row.eliminatedAtWeek ?? "?"}`}
                    </span>
                  </td>
                  <td>
                    <div className="pick-history">
                      {row.history.map((h) => (
                        <span key={`${h.week}-${h.teamId}`} className="pick-chip">
                          {weekLabelShort(season.seasonType, h.week)} {h.teamId}
                          {h.outcome === "win" ? " ✓" : h.outcome === "loss" ? " ✕" : h.outcome === "tie" ? " =" : ""}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {notIn.length > 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Not in the pool yet</h2>
          <p className="muted">Signed up but payment not confirmed.</p>
          <ul>
            {notIn.map((row) => (
              <li key={row.entryId}>{row.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
