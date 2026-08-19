import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason, entryForUser, formatMoney, seasonPotCents } from "@/lib/season";
import { liveProposalFor, suggestEqualSplit, survivorsFor } from "@/lib/splits";
import { ProposeForm, VoteButtons } from "./split-forms";

export const dynamic = "force-dynamic";

/**
 * The weekly split vote.
 *
 * Unanimity or nothing. A split need not be equal — the form starts from an even
 * split and every amount is editable, which is how a player who wants to keep
 * going gets bought out.
 */
export default async function SplitPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/dashboard");

  const entry = await entryForUser(user.id, season.id);
  const survivors = await survivorsFor(season.id);
  const pot = await seasonPotCents(season.id);
  const live = await liveProposalFor(season.id);
  const suggestion = await suggestEqualSplit(season.id);

  const amIAlive = survivors.some((s) => s.entryId === entry?.id);
  const nameByEntry = new Map(survivors.map((s) => [s.entryId, s.name]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Split the pot</h1>
          <p className="muted">
            {survivors.length} survivor(s) · {formatMoney(pot)} in the pot
          </p>
        </div>
        <Link href="/dashboard">Back to dashboard</Link>
      </div>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          Remaining players can end the season early by splitting the pot, but{" "}
          <strong>everyone still alive has to agree</strong>. One no ends it and play continues.{" "}
          <strong>Not answering counts as no.</strong> Voting closes when the next week&rsquo;s
          first game kicks off.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          The split does not have to be even. Anything the remaining players all agree to is valid.
        </p>
      </div>

      {survivors.length < 2 ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            {survivors.length === 1
              ? "Only one survivor remains — that is an outright win, not a split."
              : "No survivors remain."}
          </p>
        </div>
      ) : live ? (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Proposal from {live.proposedByName}</h2>
            {live.note ? <p>&ldquo;{live.note}&rdquo;</p> : null}

            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Would receive</th>
                </tr>
              </thead>
              <tbody>
                {live.allocations.map((a) => (
                  <tr key={a.entryId}>
                    <td>{nameByEntry.get(a.entryId) ?? a.entryId}</td>
                    <td>{formatMoney(a.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>Where the vote stands</h3>
            <ul className="vote-tally">
              {live.ballots.map((b) => (
                <li key={b.entryId}>
                  <span>{b.name}</span>
                  <span
                    className={
                      b.response === "yes"
                        ? "status-ok"
                        : b.response === "no"
                          ? "status-bad"
                          : "muted"
                    }
                  >
                    {" "}
                    {b.response === "yes"
                      ? "Agreed"
                      : b.response === "no"
                        ? "Declined"
                        : "No answer yet"}
                  </span>
                </li>
              ))}
            </ul>

            <p className="muted">{live.outcome.reason}</p>

            {amIAlive && live.outcome.status === "open" ? (
              <VoteButtons proposalId={live.id} />
            ) : null}
          </div>

          {amIAlive && live.outcome.status === "open" ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Propose different terms</h2>
              <p className="muted">
                This replaces the proposal above. <strong>Everyone has to vote again</strong> — a
                yes to one set of numbers is not a yes to another.
              </p>
              <ProposeForm
                survivors={survivors.map((s) => ({
                  entryId: s.entryId,
                  name: s.name,
                  suggested: (
                    (live.allocations.find((a) => a.entryId === s.entryId)?.amountCents ?? 0) / 100
                  ).toFixed(2),
                }))}
                potLabel={formatMoney(pot)}
              />
            </div>
          ) : null}
        </>
      ) : amIAlive ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Propose a split</h2>
          <p className="muted">
            Starts from an even split. Change any amount — the total just has to come to exactly{" "}
            {formatMoney(pot)}.
          </p>
          <ProposeForm
            survivors={survivors.map((s) => ({
              entryId: s.entryId,
              name: s.name,
              suggested: (
                (suggestion.find((a) => a.entryId === s.entryId)?.amountCents ?? 0) / 100
              ).toFixed(2),
            }))}
            potLabel={formatMoney(pot)}
          />
        </div>
      ) : (
        <div className="card">
          <p style={{ margin: 0 }}>Only remaining survivors can propose or vote on a split.</p>
        </div>
      )}
    </>
  );
}
