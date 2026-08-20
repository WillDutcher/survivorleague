/**
 * Exercises the rebuy flow, the split vote, standings visibility, and the
 * weekly reminder against a disposable season.
 */
import { and, eq, like } from "drizzle-orm";
import { db, sql as rawSql } from "../src/db/client";
import {
  entries,
  games,
  notifications,
  oddsSnapshots,
  payments,
  payouts,
  picks,
  rebuys,
  seasons,
  splitBallots,
  splitProposals,
  users,
  weeks,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { acceptRebuy, confirmRebuyPayment, openRebuyFor } from "../src/lib/rebuy-flow";
import { castBallot, liveProposalFor, openProposal, settleProposal, survivorsFor } from "../src/lib/splits";
import { loadStandings } from "../src/lib/standings";
import { sendWeeklyReminder } from "../src/lib/reminders";
import { seasonPotCents } from "../src/lib/season";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const YEAR = 2024;
let seasonId = "";

async function cleanup() {
  const [s] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.year, YEAR), eq(seasons.mode, "practice")))
    .limit(1);
  if (!s) return;
  const props = await db.select().from(splitProposals).where(eq(splitProposals.seasonId, s.id));
  for (const p of props) await db.delete(splitBallots).where(eq(splitBallots.proposalId, p.id));
  await db.delete(splitProposals).where(eq(splitProposals.seasonId, s.id));
  await db.delete(payouts).where(eq(payouts.seasonId, s.id));
  await db.delete(payments).where(eq(payments.seasonId, s.id));
  const ws = await db.select().from(weeks).where(eq(weeks.seasonId, s.id));
  for (const w of ws) {
    const gs = await db.select().from(games).where(eq(games.weekId, w.id));
    for (const g of gs) await db.delete(oddsSnapshots).where(eq(oddsSnapshots.gameId, g.id));
    await db.delete(picks).where(eq(picks.weekId, w.id));
    await db.delete(games).where(eq(games.weekId, w.id));
  }
  const es = await db.select().from(entries).where(eq(entries.seasonId, s.id));
  for (const e of es) await db.delete(rebuys).where(eq(rebuys.entryId, e.id));
  await db.delete(entries).where(eq(entries.seasonId, s.id));
  await db.delete(weeks).where(eq(weeks.seasonId, s.id));
  await db.delete(seasons).where(eq(seasons.id, s.id));
  const probes = await db.select({ id: users.id }).from(users).where(like(users.email, "eg-%@example.test"));
  for (const p of probes) await db.delete(notifications).where(eq(notifications.userId, p.id));
  await db.delete(users).where(like(users.email, "eg-%@example.test"));
}

let n = 0;
async function makePlayer(label: string, tier: "TWENTY" | "EIGHTY", status = "active") {
  n += 1;
  const [u] = await db
    .insert(users)
    .values({
      firstName: label, lastName: "Probe", email: `eg-${n}-${Date.now()}@example.test`,
      passwordHash: await hashPassword("probe-password-1"),
      dateOfBirth: "1990-01-01", stateOfResidence: "VA",
      termsVersionAccepted: "test", termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });

  const [e] = await db
    .insert(entries)
    .values({
      userId: u!.id, seasonId, tier,
      status: status as "active",
      requiredPicks: 1,
      includedRebuysRemaining: tier === "EIGHTY" ? 3 : 0,
    })
    .returning({ id: entries.id });

  // Entry fee, so the pot is real.
  await db.insert(payments).values({
    entryId: e!.id, seasonId, category: "entry",
    amountCents: tier === "EIGHTY" ? 8000 : 2000,
    status: "verified", verifiedAt: new Date(),
  });

  return { userId: u!.id, entryId: e!.id, name: `${label} Probe` };
}

async function main() {
  await cleanup();
  const config: SeasonConfig = { ...SEASON_2026, year: YEAR, mode: "live" };

  const [season] = await db
    .insert(seasons)
    .values({ year: YEAR, name: "Endgame probe", mode: "practice", registrationOpen: false, rules: config, currentWeek: 4 })
    .returning({ id: seasons.id });
  seasonId = season!.id;

  console.log("\nRebuy flow — included ($80)");
  const dave = await makePlayer("Dave", "EIGHTY");
  await db.update(entries).set({ status: "rebuy_pending" }).where(eq(entries.id, dave.entryId));
  await db.insert(rebuys).values({
    entryId: dave.entryId, lossWeekNumber: 4, kind: "included", priceCents: 0, status: "offered",
  });

  let open = await openRebuyFor(dave.entryId);
  check("an offered rebuy is visible to the player", open?.kind === "included");

  const accepted = await acceptRebuy(open!.id, dave.entryId, seasonId, config);
  check("accepting an included rebuy succeeds", accepted.ok, accepted.message);

  let [daveAfter] = await db.select().from(entries).where(eq(entries.id, dave.entryId));
  check("included rebuy reactivates immediately", daveAfter!.status === "active");
  check("and consumes one of the three", daveAfter!.includedRebuysRemaining === 2,
    String(daveAfter!.includedRebuysRemaining));
  check("no open rebuy remains", (await openRebuyFor(dave.entryId)) === null);

  const potAfterIncluded = await seasonPotCents(seasonId);
  check("an included rebuy adds nothing to the pot", potAfterIncluded === 8000,
    String(potAfterIncluded));

  console.log("\nRebuy flow — purchased ($20)");
  const mike = await makePlayer("Mike", "TWENTY");
  await db.update(entries).set({ status: "rebuy_pending" }).where(eq(entries.id, mike.entryId));
  await db.insert(rebuys).values({
    entryId: mike.entryId, lossWeekNumber: 4, kind: "paid", priceCents: 3000, status: "offered",
  });

  open = await openRebuyFor(mike.entryId);
  const takenUp = await acceptRebuy(open!.id, mike.entryId, seasonId, config);
  check("accepting a paid rebuy succeeds", takenUp.ok);

  let [mikeAfter] = await db.select().from(entries).where(eq(entries.id, mike.entryId));
  check("a PAID rebuy does NOT reactivate until confirmed", mikeAfter!.status === "rebuy_pending",
    mikeAfter!.status);

  const potBeforeConfirm = await seasonPotCents(seasonId);
  const confirmed = await confirmRebuyPayment(open!.id, dave.userId, seasonId, config, "PayPal 123");
  check("commissioner confirmation succeeds", confirmed.ok);

  [mikeAfter] = await db.select().from(entries).where(eq(entries.id, mike.entryId));
  check("confirming reactivates the entry", mikeAfter!.status === "active");

  const potAfterConfirm = await seasonPotCents(seasonId);
  check("and the $30 lands in the pot", potAfterConfirm - potBeforeConfirm === 3000,
    `${potBeforeConfirm} -> ${potAfterConfirm}`);

  const reconfirm = await confirmRebuyPayment(open!.id, dave.userId, seasonId, config, "dup");
  const potAfterDup = await seasonPotCents(seasonId);
  check("re-confirming does not double-charge", reconfirm.ok && potAfterDup === potAfterConfirm,
    `${potAfterConfirm} -> ${potAfterDup}`);

  console.log("\nNegotiated split — the commissioner's real scenario");
  const tim = await makePlayer("Tim", "TWENTY");
  const survivors = await survivorsFor(seasonId);
  check("three survivors alive", survivors.length === 3, String(survivors.length));

  const pot = await seasonPotCents(seasonId);
  const closesAt = new Date(Date.now() + 3 * 86_400_000);

  const uneven = await openProposal(
    seasonId, mike.entryId, 4,
    [
      { entryId: dave.entryId, amountCents: pot - 2 * Math.floor(pot / 3) + 4000 },
      { entryId: mike.entryId, amountCents: Math.floor(pot / 3) - 2000 },
      { entryId: tim.entryId, amountCents: Math.floor(pot / 3) - 2000 },
    ],
    "Dave gets $20 each from Mike and Tim to stop playing",
    closesAt,
  );
  check("an uneven proposal that balances is accepted", uneven.ok,
    uneven.ok ? "" : uneven.message);

  const bad = await openProposal(
    seasonId, mike.entryId, 4,
    [{ entryId: dave.entryId, amountCents: 100 }],
    null, closesAt,
  );
  check("a proposal that does not balance is refused", !bad.ok,
    bad.ok ? "" : bad.message.slice(0, 60));

  let live = await liveProposalFor(seasonId);
  check("proposal is live with all three on the ballot", live?.ballots.length === 3);
  check("nobody has answered yet", live!.outcome.status === "open");

  await castBallot(live!.id, dave.entryId, "yes");
  await castBallot(live!.id, mike.entryId, "yes");
  live = await liveProposalFor(seasonId);
  check("two yeses is not enough", live!.outcome.status === "open", live!.outcome.reason);

  const settledEarly = await settleProposal(seasonId);
  check("settling refuses without unanimity", !settledEarly.ok);

  await castBallot(live!.id, tim.entryId, "no");
  live = await liveProposalFor(seasonId);
  check("a single no ends it immediately", live!.outcome.status === "rejected", live!.outcome.reason);

  console.log("\nSupersession voids prior consents (D19b)");
  const revised = await openProposal(
    seasonId, dave.entryId, 4,
    [
      { entryId: dave.entryId, amountCents: pot - 2 * Math.floor(pot / 3) },
      { entryId: mike.entryId, amountCents: Math.floor(pot / 3) },
      { entryId: tim.entryId, amountCents: Math.floor(pot / 3) },
    ],
    "Even split instead", closesAt,
  );
  check("a replacement proposal opens", revised.ok);

  live = await liveProposalFor(seasonId);
  check("every ballot resets to no answer", live!.ballots.every((b) => b.response === "no_response"),
    live!.ballots.map((b) => b.response).join(","));

  await castBallot(live!.id, dave.entryId, "yes");
  await castBallot(live!.id, mike.entryId, "yes");
  await castBallot(live!.id, tim.entryId, "yes");
  const settled = await settleProposal(seasonId);
  check("unanimity settles the season", settled.ok, settled.message);

  const paid = await db.select().from(payouts).where(eq(payouts.seasonId, seasonId));
  const total = paid.reduce((sum, p) => sum + p.amountCents, 0);
  check("payouts recorded for all three", paid.length === 3);
  check("payouts total exactly the pot, to the cent", total === pot, `${total} vs ${pot}`);
  check("payouts are NOT marked as paid out — that is manual (D22)",
    paid.every((p) => p.paidOutAt === null));

  const settledEntries = await db.select().from(entries).where(eq(entries.seasonId, seasonId));
  check("every survivor marked settled", settledEntries.every((e) => e.status === "settled"));

  console.log("\nStandings visibility");
  const [w] = await db.insert(weeks).values({ seasonId, weekNumber: 4 }).returning({ id: weeks.id });
  const [g] = await db.insert(games).values({
    weekId: w!.id, providerGameId: "eg-1", awayTeamId: "DAL", homeTeamId: "PHI",
    kickoff: new Date(Date.now() + 86_400_000), status: "scheduled",
  }).returning({ id: games.id });

  await db.update(entries).set({ status: "active" }).where(eq(entries.id, dave.entryId));
  await db.insert(picks).values({
    entryId: dave.entryId, weekId: w!.id, slot: 1, teamId: "PHI", gameId: g!.id,
    source: "player", lockAt: new Date(Date.now() + 3_600_000), // not locked yet
  });

  const standings = await loadStandings(seasonId, 4, config);
  const daveRow = standings.find((r) => r.entryId === dave.entryId)!;
  // The reveal is tied to KICKOFF, not to the pick locking. A Monday-night pick
  // locks Sunday but must stay hidden until the game actually starts.
  check("a pick whose game has not started is NOT shown", daveRow.history.length === 0);
  check("and its current pick is withheld", daveRow.currentPick === null);
  check("but it is flagged as made-and-hidden", daveRow.currentPickHidden);

  check("rebuy position reads as a count on the $80 tier",
    /of 3 left/.test(standings.find((r) => r.entryId === dave.entryId)!.rebuyLabel),
    daveRow.rebuyLabel);
  const twentyRow = standings.find((r) => r.entryId === tim.entryId);
  check("and as a window on the $20 tier",
    /Available through Week 5/.test(twentyRow?.rebuyLabel ?? ""), twentyRow?.rebuyLabel ?? "");

  // The commissioner is exempt from the hold.
  const asAdmin = await loadStandings(seasonId, 4, config, { revealAll: true });
  const daveAdmin = asAdmin.find((r) => r.entryId === dave.entryId)!;
  check("the commissioner sees the pick before kickoff", daveAdmin.currentPick === "PHI",
    String(daveAdmin.currentPick));
  check("and it is still marked not-public", daveAdmin.currentPickHidden);
  check("and it appears in their history view", daveAdmin.history.length === 1);

  // Move the GAME into the past, not the pick's lock time.
  await db.update(games).set({ kickoff: new Date(Date.now() - 1000) }).where(eq(games.id, g!.id));
  const afterKickoff = await loadStandings(seasonId, 4, config);
  const daveVisible = afterKickoff.find((r) => r.entryId === dave.entryId)!;
  check("once the game starts the pick becomes visible", daveVisible.history.length === 1,
    daveVisible.history.map((h) => h.teamId).join(","));
  check("and it shows as this week's pick", daveVisible.currentPick === "PHI",
    String(daveVisible.currentPick));
  check("and is no longer flagged hidden", !daveVisible.currentPickHidden);

  console.log("\nWeekly reminder");
  const first = await sendWeeklyReminder(seasonId, "Endgame probe", 4, config, "http://localhost:3000");
  check("reminder sends to active players", first.sent > 0, `${first.sent} sent`);

  const second = await sendWeeklyReminder(seasonId, "Endgame probe", 4, config, "http://localhost:3000");
  check("a second attempt is refused, not double-sent", second.sent === 0 && Boolean(second.skippedReason),
    second.skippedReason ?? "");

  const logged = await db.select().from(notifications);
  check("delivery is recorded per player", logged.length >= first.sent);

  await cleanup();
  console.log(failures === 0 ? "\nAll endgame checks passed.\n" : `\n${failures} FAILED\n`);
  await rawSql.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
