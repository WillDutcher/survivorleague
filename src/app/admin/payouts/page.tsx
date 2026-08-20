import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason, formatMoney, seasonPotCents } from "@/lib/season";
import { listPayouts, payoutSummary } from "@/lib/payouts";
import { PayRow, SettleControl } from "./pay-row";

export const dynamic = "force-dynamic";

/**
 * The payout checklist.
 *
 * The app works out the amounts and holds the consent trail; it never moves
 * money (D22). This screen exists so that paying fifty people out of one PayPal
 * account is a list you tick off rather than something reconstructed from memory
 * and a text thread.
 */
export default async function PayoutsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const season = await currentSeason();
  if (!season) redirect("/admin");

  const rows = await listPayouts(season.id);
  const summary = await payoutSummary(season.id);
  const pot = await seasonPotCents(season.id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payouts</h1>
          <p className="muted">{season.name}</p>
        </div>
        <Link href="/admin">Back to commissioner tools</Link>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{formatMoney(pot)}</span>
          <span className="stat-label">Pot collected</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatMoney(summary.total)}</span>
          <span className="stat-label">Owed to players</span>
        </div>
        <div className={summary.outstanding > 0 ? "stat stat-alert" : "stat"}>
          <span className="stat-value">{formatMoney(summary.outstanding)}</span>
          <span className="stat-label">Still to send</span>
        </div>
      </div>

      {/*
        The one number that must never be wrong. If the settled amounts do not
        add back up to the pot, the difference went somewhere, and the whole
        premise is that the commissioner takes nothing (D33).
      */}
      {summary.count > 0 && summary.total !== pot ? (
        <div className="card callout-warning">
          <p style={{ margin: 0 }}>
            <strong>These do not add up.</strong> The pot is {formatMoney(pot)} but the payouts
            total {formatMoney(summary.total)}, a difference of{" "}
            {formatMoney(Math.abs(pot - summary.total))}. Do not pay anyone until this is
            explained — most likely a payment was verified after the season was settled.
          </p>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Nothing settled yet</h2>
          <p className="muted">
            Work out who gets paid once the season is decided — one survivor left, or the final
            week processed with several still alive. An agreed early split settles itself when the
            vote closes, so you will not need this button in that case.
          </p>
          <SettleControl defaultWeek={season.currentWeek ?? 1} />
        </div>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            Checklist — {summary.paidCount} of {summary.count} sent
          </h2>
          <p className="muted">
            Pay each person from PayPal, then tick them off here. Recording the transaction
            reference is optional but makes &ldquo;did I already pay Dave?&rdquo; answerable
            later.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Email</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Basis</th>
                  <th scope="col">Sent?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.paidOutAt ? undefined : "row-needs-pick"}>
                    <td>{r.name}</td>
                    <td className="muted">{r.email}</td>
                    <td>
                      <strong>{formatMoney(r.amountCents)}</strong>
                    </td>
                    <td className="muted">
                      {r.basis === "winner"
                        ? "Last survivor"
                        : r.basis === "split"
                          ? "Agreed split"
                          : "Even split"}
                    </td>
                    <td>
                      <PayRow
                        payoutId={r.id}
                        paid={Boolean(r.paidOutAt)}
                        reference={r.paidOutReference}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
