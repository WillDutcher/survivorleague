/**
 * Set up a preseason dress rehearsal against real exhibition games.
 *
 *   npm run preseason            build it and make it the active season
 *   npm run preseason -- clear   delete it and hand the app back to 2026
 *
 * Runs against PRODUCTION, because the point is to rehearse on the deployed app
 * with real kickoffs and real results.
 *
 * WHY IT IS SAFE
 * The preseason season is forced to practice mode: $0 entries, no payment gate,
 * no settlement. It is a separate season row, so the real 2026 season and its
 * 18 weeks of schedule are untouched — only which one is ACTIVE changes.
 *
 * Every test account uses an @preseason.test address so `clear` can find and
 * remove them all. Nothing here touches the commissioner's own account.
 *
 * THE PICKS ARE DELIBERATELY CONCENTRATED
 * All test players pick the same single game, split roughly in half between the
 * two teams. That guarantees a mixed result: some survive, some lose, rebuy
 * offers appear, and eliminations happen. Spreading picks across the slate
 * risks everyone winning or everyone losing, which tests nothing.
 */

import { and, eq, like } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import {
  auditEvents,
  emailVerifications,
  entries,
  games,
  notifications,
  oddsSnapshots,
  paymentReminders,
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
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";
import { weekLabel } from "../src/rules/weeks";

const url = process.env.PRODUCTION_DATABASE_URL;
if (!url) {
  console.error("PRODUCTION_DATABASE_URL is not set in .env.local.");
  process.exit(1);
}
process.env.DATABASE_URL = url;

const sql = postgres(url, { max: 1, ssl: "require" });
const db = drizzle(sql, { schema });

const YEAR = 2026;
const PASSWORD = "preseason-test-2026";
const EMAIL_DOMAIN = "preseason.test";

/**
 * ESPN preseason API weeks: 1 is the Hall of Fame game, 2-4 are what the NFL
 * calls Preseason Weeks 1-3. Both remaining weeks are loaded so there is
 * something to pick whichever day this is run.
 */
const WEEKS = [3, 4];

/**
 * Fifteen players spread across every state worth exercising.
 *
 * The $80 tier is varied by rebuys remaining so a loss produces a different
 * outcome for each: a free rebuy, a last free rebuy, or elimination. The $20
 * tier is varied by week so the $10 / $30 / none-after-week-5 pricing all show.
 */
const ROSTER = [
  { first: "Aaron", last: "Tester", tier: "EIGHTY" as const, rebuysLeft: 3 },
  { first: "Bianca", last: "Tester", tier: "EIGHTY" as const, rebuysLeft: 3 },
  { first: "Carlos", last: "Tester", tier: "EIGHTY" as const, rebuysLeft: 2 },
  { first: "Dana", last: "Tester", tier: "EIGHTY" as const, rebuysLeft: 2 },
  { first: "Eli", last: "Tester", tier: "EIGHTY" as const, rebuysLeft: 1 },
  { first: "Farrah", last: "Tester", tier: "EIGHTY" as const, rebuysLeft: 1 },
  { first: "Gus", last: "Tester", tier: "EIGHTY" as const, rebuysLeft: 0 },
  { first: "Hana", last: "Tester", tier: "EIGHTY" as const, rebuysLeft: 0 },
  { first: "Ivan", last: "Tester", tier: "TWENTY" as const, rebuysLeft: 0 },
  { first: "Jo", last: "Tester", tier: "TWENTY" as const, rebuysLeft: 0 },
  { first: "Kip", last: "Tester", tier: "TWENTY" as const, rebuysLeft: 0 },
  { first: "Lena", last: "Tester", tier: "TWENTY" as const, rebuysLeft: 0 },
  { first: "Milo", last: "Tester", tier: "TWENTY" as const, rebuysLeft: 0 },
  { first: "Nadia", last: "Tester", tier: "TWENTY" as const, rebuysLeft: 0 },
  { first: "Omar", last: "Tester", tier: "TWENTY" as const, rebuysLeft: 0 },
];

async function clearPreseason() {
  const [s] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.year, YEAR), eq(seasons.mode, "practice")))
    .limit(1);

  if (s) {
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
    for (const e of es) {
      await db.delete(rebuys).where(eq(rebuys.entryId, e.id));
      await db.delete(paymentReminders).where(eq(paymentReminders.entryId, e.id));
    }
    await db.delete(entries).where(eq(entries.seasonId, s.id));
    await db.delete(weeks).where(eq(weeks.seasonId, s.id));
    await db.delete(seasons).where(eq(seasons.id, s.id));
  }

  const testers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `%@${EMAIL_DOMAIN}`));
  for (const u of testers) {
    await db.delete(notifications).where(eq(notifications.userId, u.id));
    await db.delete(emailVerifications).where(eq(emailVerifications.userId, u.id));
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, u.id));
  }
  await db.delete(users).where(like(users.email, `%@${EMAIL_DOMAIN}`));

  // Hand the app back to the real season.
  await db.update(seasons).set({ isActive: false });
  const [real] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.year, YEAR), eq(seasons.mode, "live")))
    .limit(1);
  if (real) await db.update(seasons).set({ isActive: true }).where(eq(seasons.id, real.id));

  return { removedUsers: testers.length, hadSeason: Boolean(s) };
}

async function main() {
  if (process.argv.includes("clear")) {
    const r = await clearPreseason();
    console.log(
      `\nPreseason removed (${r.removedUsers} test accounts). The 2026 live season is active again.\n`,
    );
    await sql.end();
    return;
  }

  await clearPreseason();

  // Preseason is always practice: exhibition games must never decide real money.
  const config: SeasonConfig = { ...SEASON_2026, year: YEAR, mode: "practice", finalWeek: 4 };

  const [season] = await db
    .insert(seasons)
    .values({
      year: YEAR,
      name: `${YEAR} Preseason Rehearsal`,
      mode: "practice",
      seasonType: 1,
      isActive: true,
      registrationOpen: true,
      currentWeek: WEEKS[0],
      rules: config,
      playerInvitesEnabled: true,
    })
    .returning({ id: seasons.id });
  const seasonId = season!.id;

  await db.update(seasons).set({ isActive: false }).where(eq(seasons.mode, "live"));
  await db.update(seasons).set({ isActive: true }).where(eq(seasons.id, seasonId));

  console.log(`\nCreated ${YEAR} Preseason Rehearsal and made it active.`);
  console.log("Syncing preseason games from ESPN...\n");

  const { syncTeams, syncWeek, lockLeagueLines } = await import("../src/lib/sync");
  await syncTeams();

  for (const week of WEEKS) {
    const r = await syncWeek(seasonId, YEAR, week, config, undefined, 1);
    console.log(
      `  ${weekLabel(1, week).padEnd(18)} ${String(r.gamesUpserted).padStart(2)} games, ${String(r.linesCaptured ?? 0).padStart(2)} lines`,
    );
  }

  // Lock lines so default picks can run — they refuse on unlocked lines.
  const [firstWeek] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, WEEKS[0]!)))
    .limit(1);

  const locked = await lockLeagueLines(firstWeek!.id, "00000000-0000-0000-0000-000000000000");
  console.log(`\n  league lines locked: ${locked.locked}`);
  if (locked.missing.length) console.log(`  no line for: ${locked.missing.join(", ")}`);

  // Choose the game everyone picks: the LAST one of the week, so it is least
  // likely to have kicked off already while this is being set up.
  const weekGames = await db
    .select()
    .from(games)
    .where(eq(games.weekId, firstWeek!.id));
  weekGames.sort((a, b) => b.kickoff.getTime() - a.kickoff.getTime());
  const target = weekGames[0];

  if (!target) {
    console.error("\nNo games found for that preseason week. Nothing to pick.");
    await sql.end();
    process.exit(1);
  }

  const { hashPassword } = await import("../src/lib/auth");
  const passwordHash = await hashPassword(PASSWORD);
  const lockAt = new Date(target.kickoff.getTime() - config.earlyGameLockLeadMinutes * 60_000);

  console.log(
    `\n  Everyone picks: ${target.awayTeamId} @ ${target.homeTeamId}, ` +
      `kickoff ${target.kickoff.toISOString()}\n`,
  );

  const created: Array<{ email: string; name: string; tier: string; team: string; rebuys: number }> = [];

  for (const [index, person] of ROSTER.entries()) {
    const email = `${person.first.toLowerCase()}@${EMAIL_DOMAIN}`;

    const [u] = await db
      .insert(users)
      .values({
        firstName: person.first,
        lastName: person.last,
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        dateOfBirth: "1985-06-15",
        stateOfResidence: "VA",
        termsVersionAccepted: "2026.1",
        termsAcceptedAt: new Date(),
      })
      .returning({ id: users.id });

    const [e] = await db
      .insert(entries)
      .values({
        userId: u!.id,
        seasonId,
        tier: person.tier,
        // Practice mode: active immediately, no payment gate.
        status: "active",
        requiredPicks: 1,
        includedRebuysRemaining: person.rebuysLeft,
      })
      .returning({ id: entries.id });

    // Split the roster between the two sides so the week cannot end with
    // everyone surviving or everyone out.
    const team = index % 2 === 0 ? target.homeTeamId : target.awayTeamId;

    await db.insert(picks).values({
      entryId: e!.id,
      weekId: firstWeek!.id,
      slot: 1,
      teamId: team,
      gameId: target.id,
      source: "player",
      lockAt,
    });

    created.push({
      email,
      name: `${person.first} ${person.last}`,
      tier: person.tier === "EIGHTY" ? "$80" : "$20",
      team,
      rebuys: person.rebuysLeft,
    });
  }

  const onHome = created.filter((c) => c.team === target.homeTeamId).length;

  console.log("=".repeat(70));
  console.log("  PRESEASON REHEARSAL READY");
  console.log("=".repeat(70));
  console.log(`\n  Sign in at https://survivorleague-mu.vercel.app/login`);
  console.log(`  Password for EVERY test account: ${PASSWORD}\n`);
  console.log("  account                        tier  rebuys  picked");
  console.log("  " + "-".repeat(58));
  for (const c of created) {
    console.log(
      `  ${c.email.padEnd(30)} ${c.tier}   ${String(c.rebuys).padStart(2)}     ${c.team}`,
    );
  }
  console.log(`\n  ${onHome} picked ${target.homeTeamId}, ${created.length - onHome} picked ${target.awayTeamId}`);
  console.log(`  Whoever wins, the other side loses — so you get survivals AND eliminations.`);
  console.log(`\n  Your own commissioner account still works and is admin here.`);
  console.log(`  Run  npm run preseason -- clear  to remove it and restore 2026.\n`);

  await sql.end();
}

main().catch(async (error) => {
  console.error("\nFailed: " + (error instanceof Error ? error.message : String(error)));
  await sql.end().catch(() => {});
  process.exit(1);
});
