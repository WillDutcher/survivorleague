import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listInvites } from "@/lib/invites";
import { currentSeason, formatMoney, listEntries, seasonPotCents } from "@/lib/season";
import { tierConfig } from "@/rules/config";
import { rebuysAwaitingPayment } from "@/lib/rebuy-flow";
import { reminderHistory } from "@/lib/payment-nag";
import { unverifiedUsers } from "@/lib/verification";
import { NagControl } from "./nag-control";
import { LogoToggle, SyncControl } from "./display-controls";
import { RebuyRow } from "./rebuy-row";
import { ReminderControl, WeekControls } from "./week-controls";
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
  const pendingRebuys = await rebuysAwaitingPayment(season.id);
  const unverified = await unverifiedUsers();
  const nagged = await reminderHistory(season.id);
  const entryNameById = new Map(entries.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

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
        <p className="muted" style={{ margin: 0 }}>
          <Link href="/dashboard">My dashboard</Link>
          {" · "}
          <Link href="/status">Environment status</Link>
        </p>
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

        <NagControl
          outstanding={awaiting.length}
          history={nagged.map((n) => `${n.name}: step ${Math.max(...n.steps)}`)}
        />

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
        <h2 style={{ marginTop: 0 }}>Rebuys awaiting payment</h2>
        <p className="muted">
          These players chose to buy back in. They are NOT active again until you confirm the money
          arrived — confirming is what reactivates them and grows the pot.
        </p>
        {pendingRebuys.length === 0 ? (
          <p className="status-ok"> No rebuy payments outstanding.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Lost</th>
                <th scope="col">Owed</th>
                <th scope="col">Confirm</th>
              </tr>
            </thead>
            <tbody>
              {pendingRebuys.map((r) => (
                <RebuyRow
                  key={r.rebuyId}
                  rebuyId={r.rebuyId}
                  name={entryNameById.get(r.entryId) ?? "Unknown"}
                  lossWeek={r.lossWeekNumber}
                  price={formatMoney(r.priceCents)}
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
        <h2 style={{ marginTop: 0 }}>Data sync</h2>
        <p className="muted">
          Pulls teams, schedule, scores and candidate point spreads from ESPN. Safe to run
          repeatedly — it updates in place and never duplicates. Lines captured here are{" "}
          <strong>not</strong> league lines until you lock them.
        </p>
        <SyncControl defaultWeek={season.currentWeek ?? 1} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Run the week</h2>
        <p className="muted">
          The normal order is sync, lock lines Thursday, then process results once games are final.
          Every one of these is safe to run twice — none of them will double-charge a rebuy or
          eliminate someone twice.
        </p>
        <WeekControls defaultWeek={season.currentWeek ?? 1} />
        <ReminderControl defaultWeek={season.currentWeek ?? 1} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Team display</h2>
        <p className="muted">
          Colours are the default and carry no trademark exposure. Logos are hotlinked from the
          provider, never copied, and are a deliberate opt-in — switch back in one click if this
          pool ever becomes public-facing. Team names are always shown as text either way.
        </p>
        <LogoToggle enabled={season.showTeamLogos} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Unconfirmed emails</h2>
        <p className="muted">
          These addresses have never been confirmed, so reminders may be going nowhere. This does
          not stop anyone playing — it just means you cannot rely on reaching them.
        </p>
        {unverified.length === 0 ? (
          <p className="status-ok"> Every address is confirmed.</p>
        ) : (
          <ul>
            {unverified.map((u) => (
              <li key={u.id}>
                {u.firstName} {u.lastName} — <span className="muted">{u.email}</span>
              </li>
            ))}
          </ul>
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
