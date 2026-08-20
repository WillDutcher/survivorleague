/**
 * Settlement and the payout checklist, against a disposable season.
 *
 * The check that matters most is that the payouts sum EXACTLY back to the pot.
 * A missing cent is arithmetically indistinguishable from a rake, and the whole
 * premise is that the commissioner takes nothing (D33).
 */
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "../src/db/client";
import { auditEvents, entries, payments, payouts, seasons, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { listPayouts, markPaidOut, payoutSummary, settleSeasonNow } from "../src/lib/payouts";
import { seasonPotCents } from "../src/lib/season";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// seasons carries unique(year, mode), so each scenario needs its own year.
const YEARS = [2020, 2021, 2022];

async function cleanup() {
  const all = await db.select().from(seasons).where(inArray(seasons.year, YEARS));
  for (const s of all) {
    await db.delete(payouts).where(eq(payouts.seasonId, s.id));
    await db.delete(payments).where(eq(payments.seasonId, s.id));
    await db.delete(entries).where(eq(entries.seasonId, s.id));
    await db.delete(seasons).where(eq(seasons.id, s.id));
  }
  const probes = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "po-%@example.test"));
  for (const p of probes) await db.delete(auditEvents).where(eq(auditEvents.actorUserId, p.id));
  await db.delete(users).where(like(users.email, "po-%@example.test"));
}

let n = 0;
async function makePlayer(seasonId: string, feeCents: number, status = "active") {
  n += 1;
  const [u] = await db
    .insert(users)
    .values({
      firstName: `P${n}`,
      lastName: "Probe",
      email: `po-${n}-${Date.now()}@example.test`,
      passwordHash: await hashPassword("probe-password-1"),
      dateOfBirth: "1990-01-01",
      stateOfResidence: "VA",
      termsVersionAccepted: "test",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });

  const [e] = await db
    .insert(entries)
    .values({
      userId: u!.id,
      seasonId,
      tier: feeCents >= 8000 ? "EIGHTY" : "TWENTY",
      status: status as "active",
      requiredPicks: 1,
      includedRebuysRemaining: 0,
    })
    .returning({ id: entries.id });

  await db.insert(payments).values({
    entryId: e!.id,
    seasonId,
    category: "entry",
    amountCents: feeCents,
    status: "verified",
    verifiedAt: new Date(),
  });

  return e!.id;
}

async function makeSeason(config: SeasonConfig, name: string, year: number) {
  const [s] = await db
    .insert(seasons)
    .values({
      year,
      name,
      mode: "practice",
      registrationOpen: false,
      rules: config,
      currentWeek: 18,
    })
    .returning({ id: seasons.id });
  return s!.id;
}

async function main() {
  await cleanup();
  const config: SeasonConfig = { ...SEASON_2026, mode: "live" };

  const [admin] = await db
    .insert(users)
    .values({
      firstName: "Comm",
      lastName: "Probe",
      email: `po-admin-${Date.now()}@example.test`,
      passwordHash: await hashPassword("probe-password-1"),
      isAdmin: true,
      dateOfBirth: "1990-01-01",
      stateOfResidence: "VA",
      termsVersionAccepted: "test",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });

  console.log("\nSeason still running");
  const running = await makeSeason(config, "Still going", YEARS[0]!);
  await makePlayer(running, 8000);
  await makePlayer(running, 8000);
  let r = await settleSeasonNow(running, config, 10, admin!.id);
  check("two alive in week 10 will not settle", !r.ok, r.message);

  console.log("\nOne survivor takes the pot");
  const solo = await makeSeason(config, "One winner", YEARS[1]!);
  const winner = await makePlayer(solo, 8000);
  await makePlayer(solo, 8000, "eliminated");
  await makePlayer(solo, 2000, "eliminated");

  r = await settleSeasonNow(solo, config, 12, admin!.id);
  check("a single survivor settles before week 18", r.ok, r.message);

  let pot = await seasonPotCents(solo);
  let sum = await payoutSummary(solo);
  check("the payouts equal the pot exactly", sum.total === pot, `${sum.total} vs ${pot}`);
  check("and it all goes to the survivor", sum.count === 1, String(sum.count));

  let list = await listPayouts(solo);
  check("the winner is the one still alive", list[0]!.entryId === winner);
  check("recorded as a winner payout", list[0]!.basis === "winner", list[0]!.basis);

  r = await settleSeasonNow(solo, config, 12, admin!.id);
  check("settling twice is refused, not doubled", !r.ok, r.message);
  sum = await payoutSummary(solo);
  check("and the total did not move", sum.total === pot, String(sum.total));

  console.log("\nMarking money as sent");
  check("nothing is paid to begin with", sum.paid === 0);
  r = await markPaidOut(list[0]!.id, solo, admin!.id, "PAYPAL-9931");
  check("a payout can be marked paid", r.ok, r.message);

  sum = await payoutSummary(solo);
  check("outstanding drops to zero", sum.outstanding === 0, String(sum.outstanding));
  list = await listPayouts(solo);
  check("the reference is kept", list[0]!.paidOutReference === "PAYPAL-9931");

  const firstPaidAt = list[0]!.paidOutAt!;
  r = await markPaidOut(list[0]!.id, solo, admin!.id, "DIFFERENT-REF");
  check("marking paid twice is accepted quietly", r.ok, r.message);
  list = await listPayouts(solo);
  check(
    "but the original date is NOT rewritten",
    list[0]!.paidOutAt!.getTime() === firstPaidAt.getTime(),
  );
  check("nor the original reference", list[0]!.paidOutReference === "PAYPAL-9931");

  console.log("\nSeveral survive week 18 — even split, awkward pot");
  const tie = await makeSeason(config, "Week 18 split", YEARS[2]!);
  // Three $80 entries plus one $20 = $260, which does not divide by three.
  await makePlayer(tie, 8000);
  await makePlayer(tie, 8000);
  await makePlayer(tie, 8000);
  await makePlayer(tie, 2000, "eliminated");

  r = await settleSeasonNow(tie, config, 18, admin!.id);
  check("week 18 with several alive settles", r.ok, r.message);

  pot = await seasonPotCents(tie);
  sum = await payoutSummary(tie);
  check("three people are owed", sum.count === 3, String(sum.count));
  check(
    "an indivisible pot still sums back exactly",
    sum.total === pot,
    `${sum.total} vs ${pot} (pot/3 = ${pot / 3})`,
  );

  const amounts = (await listPayouts(tie)).map((p) => p.amountCents).sort();
  check(
    "and nobody is short by more than a cent",
    amounts[amounts.length - 1]! - amounts[0]! <= 1,
    amounts.join(", "),
  );

  console.log("\nAudit");
  const settleAudits = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, "season"), eq(auditEvents.actorUserId, admin!.id)));
  check("every settlement is audited", settleAudits.length === 2, String(settleAudits.length));
  const paidAudits = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, "payout"), eq(auditEvents.actorUserId, admin!.id)));
  check("and so is each payment sent", paidAudits.length === 1, String(paidAudits.length));

  await cleanup();
  console.log(failures === 0 ? "\nAll payout checks passed.\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
