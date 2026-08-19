/** Exercises email verification and the escalating payment reminders. */
import { and, eq, like } from "drizzle-orm";
import { db, sql as rawSql } from "../src/db/client";
import { entries, paymentReminders, payments, seasons, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { sendPaymentReminders, NAG_STEPS } from "../src/lib/payment-nag";
import { consumeVerification, isVerified, issueVerification, unverifiedUsers } from "../src/lib/verification";
import { currentSeason } from "../src/lib/season";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const YEAR = 2023;
let seasonId = "";

async function cleanup() {
  const [s] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.year, YEAR), eq(seasons.mode, "live")))
    .limit(1);
  if (s) {
    const es = await db.select().from(entries).where(eq(entries.seasonId, s.id));
    for (const e of es) await db.delete(paymentReminders).where(eq(paymentReminders.entryId, e.id));
    await db.delete(payments).where(eq(payments.seasonId, s.id));
    await db.delete(entries).where(eq(entries.seasonId, s.id));
    await db.delete(seasons).where(eq(seasons.id, s.id));
  }
  await db.delete(users).where(like(users.email, "nag-%@example.test"));
}

let n = 0;
async function makeUnpaid(label: string, signedUpDaysAgo: number) {
  n += 1;
  const [u] = await db
    .insert(users)
    .values({
      firstName: label, lastName: "Probe", email: `nag-${n}-${Date.now()}@example.test`,
      passwordHash: await hashPassword("probe-password-1"),
      dateOfBirth: "1990-01-01", stateOfResidence: "VA",
      termsVersionAccepted: "test", termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });

  const [e] = await db
    .insert(entries)
    .values({
      userId: u!.id, seasonId, tier: "TWENTY", status: "registered",
      requiredPicks: 1, includedRebuysRemaining: 0,
      createdAt: new Date(Date.now() - signedUpDaysAgo * 86_400_000),
    })
    .returning({ id: entries.id });

  return { userId: u!.id, entryId: e!.id };
}

async function main() {
  await cleanup();

  console.log("\nEmail verification");
  const real = await currentSeason();
  const probe = await db
    .insert(users)
    .values({
      firstName: "Verify", lastName: "Probe", email: `nag-v-${Date.now()}@example.test`,
      passwordHash: await hashPassword("probe-password-1"),
      dateOfBirth: "1990-01-01", stateOfResidence: "VA",
      termsVersionAccepted: "test", termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  const probeId = probe[0]!.id;

  check("a new account starts unverified", !(await isVerified(probeId)));
  check("and appears in the unreachable list",
    (await unverifiedUsers()).some((u) => u.id === probeId));

  const token = await issueVerification(probeId);
  const bad = await consumeVerification("not-a-real-token");
  check("a bogus token is rejected", !bad.ok);

  const good = await consumeVerification(token);
  check("a valid token verifies the address", good.ok);
  check("the user is now verified", await isVerified(probeId));

  const replay = await consumeVerification(token);
  check("the token cannot be replayed", !replay.ok);

  const first = await issueVerification(probeId);
  const second = await issueVerification(probeId);
  check("issuing a new token invalidates the previous one",
    !(await consumeVerification(first)).ok);
  check("and the newest token works", (await consumeVerification(second)).ok);

  await db.delete(users).where(eq(users.id, probeId));

  console.log("\nEscalating payment reminders");
  const config = real?.config ?? undefined;
  const [season] = await db
    .insert(seasons)
    .values({
      year: YEAR, name: "Nag probe", mode: "live", registrationOpen: true,
      rules: config ?? {},
    })
    .returning({ id: seasons.id });
  seasonId = season!.id;

  const seasonRow = {
    id: seasonId, year: YEAR, name: "Nag probe", mode: "live" as const,
    registrationOpen: true, currentWeek: 1, playerInvitesEnabled: true,
    showTeamLogos: false, config: (config ?? {}) as never,
  };

  const fresh = await makeUnpaid("Fresh", 0);
  const twoDays = await makeUnpaid("TwoDays", 3);
  const sixDays = await makeUnpaid("SixDays", 7);
  const stale = await makeUnpaid("Stale", 20);

  let report = await sendPaymentReminders(seasonRow, "http://localhost:3000");
  check("someone who just signed up is not nagged yet", report.sent === 3,
    `${report.sent} sent — ${report.details.join(", ")}`);

  const sentRows = await db.select().from(paymentReminders);
  const stepFor = (entryId: string) =>
    sentRows.filter((r) => r.entryId === entryId).map((r) => r.step);

  check("3 days in gets step 1", stepFor(twoDays.entryId).includes(1), String(stepFor(twoDays.entryId)));
  check("7 days in gets step 2", stepFor(sixDays.entryId).includes(2), String(stepFor(sixDays.entryId)));
  check("20 days in gets step 3", stepFor(stale.entryId).includes(3), String(stepFor(stale.entryId)));
  check("a long-overdue player gets ONE email, not all three at once",
    stepFor(stale.entryId).length === 1, String(stepFor(stale.entryId)));
  check("the brand new signup got nothing", stepFor(fresh.entryId).length === 0);

  report = await sendPaymentReminders(seasonRow, "http://localhost:3000");
  check("running again sends nothing — no double-nagging", report.sent === 0,
    `${report.sent} sent`);

  // Escalation must never go backwards: someone who has had "last call" should
  // not later receive the gentle nudge.
  const stepsAfterRerun = await db.select().from(paymentReminders);
  const staleSteps = stepsAfterRerun.filter((r) => r.entryId === stale.entryId).map((r) => r.step);
  check("a player at last call never drops back to an earlier step",
    staleSteps.length === 1 && staleSteps[0] === 3, String(staleSteps));

  console.log("\nPaid players are never nagged");
  await db.insert(payments).values({
    entryId: twoDays.entryId, seasonId, category: "entry",
    amountCents: 2000, status: "verified", verifiedAt: new Date(),
  });
  await db.delete(paymentReminders).where(eq(paymentReminders.entryId, twoDays.entryId));
  report = await sendPaymentReminders(seasonRow, "http://localhost:3000");
  const afterPaid = await db.select().from(paymentReminders).where(eq(paymentReminders.entryId, twoDays.entryId));
  check("a player who has paid is skipped entirely", afterPaid.length === 0);

  console.log("\nPractice seasons");
  const practice = { ...seasonRow, mode: "practice" as const };
  report = await sendPaymentReminders(practice, "http://localhost:3000");
  check("practice seasons never nag anyone", report.sent === 0 && report.details[0]!.includes("Practice"),
    report.details[0] ?? "");

  check("escalation is only three steps", NAG_STEPS.length === 3);

  await cleanup();
  console.log(failures === 0 ? "\nAll verification and nag checks passed.\n" : `\n${failures} FAILED\n`);
  await rawSql.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
