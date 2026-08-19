import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listInvites } from "@/lib/invites";
import { currentSeason, formatMoney, listEntries, seasonPotCents } from "@/lib/season";
import { tierConfig } from "@/rules/config";
import { PaymentRow } from "./payment-row";
import { RevokeInviteButton } from "./revoke-invite-button";

export const dynamic = "force-dynamic";

/**
 * Commissioner tools.
 *
 * Dense and terse on purpose (D2): this is a single admin who knows the league
 * inside out and wants to clear a payment queue in thirty seconds, not be
 * walked through it.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const season = await currentSeason();
  if (!season) {
    return (
      <>
        <h1>Commissioner</h1>
        <div className="card">
          <p>No season exists yet. Run <code>npm run seed</code>.</p>
        </div>
      </>
    );
  }

  const entries = await listEntries(season.id);
  const pot = await seasonPotCents(season.id);
  const invites = await listInvites(season.id);

  const awaiting = entries.filter((e) => e.amountOwedCents > 0);
  const active = entries.filter((e) => e.status === "active");
  const unclaimed = invites.filter((i) => !i.claimedByName && !i.revokedAt && i.uses < i.maxUses);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Commissioner</h1>
          <p className="muted">
            {season.name} · {season.mode === "practice" ? "practice" : "live"} ·{" "}
            registration {season.registrationOpen ? "open" : "closed"}
          </p>
        </div>
        <Link href="/dashboard">Back to my dashboard</Link>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{formatMoney(pot)}</span>
          <span className="stat-label">Pot (confirmed)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{active.length}</span>
          <span className="stat-label">Active players</span>
        </div>
        <div className="stat">
          <span className="stat-value">{awaiting.length}</span>
          <span className="stat-label">Awaiting payment</span>
        </div>
        <div className="stat">
          <span className="stat-value">{unclaimed.length}</span>
          <span className="stat-label">Invites unclaimed</span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Waiting on payment</h2>
        <p className="muted">
          Marking someone paid puts them in the pool immediately and adds their entry to the pot.
          Every change here is recorded in the audit log with your name on it.
        </p>

        {awaiting.length === 0 ? (
          <p className="status-ok"> Nobody is waiting. Everyone who has signed up has paid.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Option</th>
                <th scope="col">Owed</th>
                <th scope="col">Confirm</th>
              </tr>
            </thead>
            <tbody>
              {awaiting.map((entry) => (
                <PaymentRow
                  key={entry.id}
                  entryId={entry.id}
                  name={`${entry.firstName} ${entry.lastName}`}
                  email={entry.email}
                  tierLabel={tierConfig(season.config, entry.tier).label}
                  owed={formatMoney(entry.amountOwedCents)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>All entries</h2>
        {entries.length === 0 ? (
          <p className="muted">Nobody has signed up yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Email</th>
                <th scope="col">Option</th>
                <th scope="col">Status</th>
                <th scope="col">Paid</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {entry.lastName}, {entry.firstName}
                  </td>
                  <td className="muted">{entry.email}</td>
                  <td>{tierConfig(season.config, entry.tier).label}</td>
                  <td>
                    <span className={entry.status === "active" ? "status-ok" : "status-bad"}>
                      {" "}
                      {entry.status}
                    </span>
                  </td>
                  <td>{formatMoney(entry.amountPaidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Invites</h2>
        <p className="muted">
          Unclaimed invites are people who were invited but never signed up — chase these.
        </p>
        {invites.length === 0 ? (
          <p className="muted">No invites issued yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Note</th>
                <th scope="col">Issued by</th>
                <th scope="col">Uses</th>
                <th scope="col">Claimed by</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.note ?? <span className="muted">—</span>}</td>
                  <td className="muted">{invite.createdByName ?? "seed script"}</td>
                  <td>
                    {invite.uses} / {invite.maxUses}
                    {invite.revokedAt ? <span className="muted"> · revoked</span> : null}
                  </td>
                  <td>
                    {invite.claimedByName ?? <span className="muted">not yet</span>}
                  </td>
                  <td>
                    {!invite.revokedAt && invite.uses < invite.maxUses ? (
                      <RevokeInviteButton inviteId={invite.id} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
