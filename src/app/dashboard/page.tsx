import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentSeason, entryForUser, formatMoney, seasonPotCents } from "@/lib/season";
import { canIssueInvites } from "@/lib/invites";
import { tierConfig } from "@/rules/config";
import { InviteButton } from "./invite-button";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const season = await currentSeason();
  if (!season) {
    return (
      <>
        <h1>No season yet</h1>
        <div className="card">
          <p>The commissioner has not set up a season. Check back shortly.</p>
        </div>
      </>
    );
  }

  const entry = await entryForUser(user.id, season.id);
  const pot = await seasonPotCents(season.id);
  const mayInvite = await canIssueInvites(user.id, season.id);
  const tier = entry ? tierConfig(season.config, entry.tier) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {user.firstName} {user.lastName}
          </h1>
          <p className="muted">
            {season.name}
            {season.mode === "practice" ? " — practice season, no money involved" : null}
          </p>
        </div>
        <SignOutButton />
      </div>

      {/* The unpaid banner is the whole point of D9: the app does the nagging. */}
      {entry && entry.amountOwedCents > 0 ? (
        <div className="card callout-warning">
          <h2 style={{ marginTop: 0 }}>You are not in the pool yet</h2>
          <p>
            Your entry is <strong>not active</strong> until your payment is confirmed. Until then
            you hold no place in the pool and no share of the pot, and your picks will not count.
          </p>
          <p>
            <strong>Amount due: {formatMoney(entry.amountOwedCents)}</strong> for the {tier?.label}.
          </p>
          <p className="muted">
            Send it by PayPal to the commissioner, marked <strong>friends and family</strong>, with
            your full name in the note. Once he confirms it, this banner disappears and you can
            make picks.
          </p>
        </div>
      ) : null}

      {entry && entry.amountOwedCents === 0 && entry.status === "active" ? (
        <div className="card">
          <p className="status-ok" style={{ margin: 0 }}>
            {" "}
            You are in. Entry confirmed for the {tier?.label}.
          </p>
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your entry</h2>
        {entry ? (
          <table>
            <tbody>
              <tr>
                <th scope="row">Status</th>
                <td>{humanStatus(entry.status)}</td>
              </tr>
              <tr>
                <th scope="row">Entry option</th>
                <td>{tier?.label}</td>
              </tr>
              <tr>
                <th scope="row">Paid</th>
                <td>{formatMoney(entry.amountPaidCents)}</td>
              </tr>
              {tier && tier.includedRebuys > 0 ? (
                <tr>
                  <th scope="row">Rebuys remaining</th>
                  <td>
                    {entry.includedRebuysRemaining} of {tier.includedRebuys} — usable for losses
                    through Week {tier.includedRebuyThroughWeek}, then they expire
                  </td>
                </tr>
              ) : null}
              <tr>
                <th scope="row">Picks required next week</th>
                <td>
                  {entry.requiredPicks}
                  {entry.requiredPicks > 1 ? (
                    <> — you tied, so you must win {entry.requiredPicks} games to survive</>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="muted">You do not have an entry in this season.</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Pool</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Current pot</th>
              <td>{formatMoney(pot)}</td>
            </tr>
            <tr>
              <th scope="row">Current week</th>
              <td>{season.currentWeek ?? "Season has not started"}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted hint">
          The pot counts confirmed payments only, so it rises as the commissioner verifies entries.
        </p>
      </div>

      {mayInvite ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Invite someone</h2>
          <p className="muted">
            Generate a single-use link to send to someone you want in the pool. They still have to
            pay before they are in.
          </p>
          <InviteButton />
        </div>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Invites</h2>
          <p className="muted">
            Once your entry is paid and active you will be able to invite other players.
          </p>
        </div>
      )}

      <p className="muted">
        <Link href="/rules">League rules and terms</Link>
        {user.isAdmin ? (
          <>
            {" · "}
            <Link href="/admin">Commissioner tools</Link>
          </>
        ) : null}
      </p>
    </>
  );
}

function humanStatus(status: string): string {
  switch (status) {
    case "registered":
      return "Registered — awaiting payment";
    case "paid":
      return "Paid — awaiting activation";
    case "active":
      return "Active";
    case "rebuy_pending":
      return "Rebuy pending";
    case "eliminated":
      return "Eliminated";
    case "winner":
      return "Winner";
    case "settled":
      return "Settled";
    default:
      return status;
  }
}
