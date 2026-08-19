/**
 * Build a realistic, fully-played demo league so the whole app can be clicked
 * through locally.
 *
 *   npm run demo         build it and make it the active season
 *   npm run demo:clear   delete it and hand the app back to the real season
 *
 * Uses REAL completed 2025 results, so survivals and eliminations are what
 * actually happened rather than invented outcomes. Ends mid-season with a
 * deliberate spread of states: survivors, eliminations, an outstanding rebuy,
 * someone carrying a tie debt, and an unpaid signup.
 *
 * Every account uses the same password so you can sign in as anyone and see the
 * app through their eyes.
 */

import { and, eq, like } from "drizzle-orm";
import { db, sql as rawSql } from "../src/db/client";
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
import { hashPassword } from "../src/lib/auth";
import { processWeekResults } from "../src/lib/processing";
import { lockLeagueLines } from "../src/lib/sync";
import { payloadFromScoreboard, syncWeek } from "../src/lib/sync";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";
import demoWeek1 from "../src/integrations/fixtures/espn-2025-week1.json";
import demoWeek2 from "../src/integrations/fixtures/espn-2025-week2.json";
import demoWeek3 from "../src/integrations/fixtures/espn-2025-week3.json";
import demoWeek4 from "../src/integrations/fixtures/espn-2025-week4.json";

/**
 * Captured real payloads, so the demo builds offline and identically every time.
 * Falls back to a live fetch for any week not bundled.
 */
const BUNDLED: Record<number, unknown> = {
  1: demoWeek1,
  2: demoWeek2,
  3: demoWeek3,
  4: demoWeek4,
};

const DEMO_YEAR = 2025;
const PASSWORD = "demo-password-2026";
const WEEKS_TO_PLAY = [1, 2, 3, 4];

const ROSTER = [
  { first: "Chappy", last: "Morales", tier: "EIGHTY" as const, fate: "survive" },
  { first: "Chico", last: "Mitchell", tier: "EIGHTY" as const, fate: "survive" },
  { first: "Kyle", last: "Berry", tier: "TWENTY" as const, fate: "survive" },
  { first: "Jarvis", last: "Abbott", tier: "TWENTY" as const, fate: "lose-week-3" },
  { first: "Tom", last: "Bennett", tier: "EIGHTY" as const, fate: "lose-week-2" },
  { first: "Caleb", last: "Grabowski", tier: "TWENTY" as const, fate: "lose-week-1" },
  { first: "Amanda", last: "Dutcher", tier: "EIGHTY" as const, fate: "survive" },
  { first: "Fred", last: "Amponsem", tier: "TWENTY" as const, fate: "unpaid" },
];

async function clearDemo() {
  const [s] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.year, DEMO_YEAR), eq(seasons.mode, "live")))
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

  const demoUsers = await db.select({ id: users.id }).from(users).where(like(users.email, "%@demo.test"));
  for (const u of demoUsers) {
    await db.delete(notifications).where(eq(notifications.userId, u.id));
    await db.delete(emailVerifications).where(eq(emailVerifications.userId, u.id));
    await db.delete(auditEvents).where(eq(auditEvents.actorUserId, u.id));
  }
  await db.delete(users).where(like(users.email, "%@demo.test"));

  // Hand the app back to whatever real season exists.
  await db.update(seasons).set({ isActive: false });
  const [real] = await db.select().from(seasons).limit(1);
  if (real) await db.update(seasons).set({ isActive: true }).where(eq(seasons.id, real.id));
}

async function fetchWeekPayload(weekNumber: number) {
  const bundled = BUNDLED[weekNumber];
  if (bundled) return bundled;

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${DEMO_YEAR}&seasontype=2&week=${weekNumber}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`ESPN returned ${response.status} for week ${weekNumber}`);
  return response.json();
}

async function main() {
  if (process.argv.includes("clear")) {
    await clearDemo();
    console.log("Demo league removed. The real season is active again.");
    await rawSql.end();
    return;
  }

  await clearDemo();

  const config: SeasonConfig = { ...SEASON_2026, year: DEMO_YEAR };

  const [season] = await db
    .insert(seasons)
    .values({
      year: DEMO_YEAR,
      name: `${DEMO_YEAR} Demo League`,
      mode: "live",
      registrationOpen: true,
      rules: config,
      currentWeek: WEEKS_TO_PLAY.at(-1)!,
      isActive: true,
    })
    .returning({ id: seasons.id });
  const seasonId = season!.id;

  await db.update(seasons).set({ isActive: false }).where(eq(seasons.year, 2026));

  console.log(`Created ${DEMO_YEAR} Demo League and made it active.\n`);

  // Real schedules and results.
  console.log("Loading real 2025 results...");
  const weekIds = new Map<number, string>();
  for (const weekNumber of WEEKS_TO_PLAY) {
    const payload = await fetchWeekPayload(weekNumber);
    const result = await syncWeek(seasonId, DEMO_YEAR, weekNumber, config, payloadFromScoreboard(payload));
    const [w] = await db
      .select()
      .from(weeks)
      .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
      .limit(1);
    weekIds.set(weekNumber, w!.id);
    await lockLeagueLines(w!.id, "00000000-0000-0000-0000-000000000000");
    console.log(`  Week ${weekNumber}: ${result.gamesUpserted} games, lines locked`);
  }

  // Players.
  const passwordHash = await hashPassword(PASSWORD);
  const players: Array<{ entryId: string; email: string; name: string; fate: string; used: Set<string> }> = [];

  for (const person of ROSTER) {
    const email = `${person.first.toLowerCase()}@demo.test`;
    const [u] = await db
      .insert(users)
      .values({
        firstName: person.first,
        lastName: person.last,
        email,
        passwordHash,
        emailVerifiedAt: person.fate === "unpaid" ? null : new Date(),
        dateOfBirth: "1985-06-15",
        stateOfResidence: "VA",
        termsVersionAccepted: "2026.1",
        termsAcceptedAt: new Date(),
      })
      .returning({ id: users.id });

    const unpaid = person.fate === "unpaid";
    const [e] = await db
      .insert(entries)
      .values({
        userId: u!.id,
        seasonId,
        tier: person.tier,
        status: unpaid ? "registered" : "active",
        requiredPicks: 1,
        includedRebuysRemaining: person.tier === "EIGHTY" ? 3 : 0,
        createdAt: new Date(Date.now() - 9 * 86_400_000),
      })
      .returning({ id: entries.id });

    if (!unpaid) {
      await db.insert(payments).values({
        entryId: e!.id,
        seasonId,
        category: "entry",
        amountCents: person.tier === "EIGHTY" ? 8000 : 2000,
        status: "verified",
        externalReference: "PayPal (demo)",
        verifiedAt: new Date(),
      });
    }

    players.push({
      entryId: e!.id,
      email,
      name: `${person.first} ${person.last}`,
      fate: person.fate,
      used: new Set(),
    });
  }

  console.log(`\nCreated ${players.length} players.\n`);

  // Play the weeks. Winners get a team that actually won; the doomed get one
  // that actually lost, in the week their fate says.
  for (const weekNumber of WEEKS_TO_PLAY) {
    const weekId = weekIds.get(weekNumber)!;
    const weekGames = await db.select().from(games).where(eq(games.weekId, weekId));

    for (const player of players) {
      const [entry] = await db.select().from(entries).where(eq(entries.id, player.entryId));
      if (!entry || entry.status !== "active") continue;

      const shouldLose = player.fate === `lose-week-${weekNumber}`;

      const candidates = weekGames
        .filter((g) => g.homeScore !== null && g.awayScore !== null)
        .flatMap((g) => {
          const homeWon = g.homeScore! > g.awayScore!;
          const drew = g.homeScore === g.awayScore;
          return [
            { game: g, team: g.homeTeamId, won: homeWon, drew },
            { game: g, team: g.awayTeamId, won: !homeWon && !drew, drew },
          ];
        })
        .filter((c) => !player.used.has(c.team) && (shouldLose ? !c.won && !c.drew : c.won));

      const choice = candidates[Math.floor(candidates.length / 2)] ?? candidates[0];
      if (!choice) continue;

      player.used.add(choice.team);
      await db.insert(picks).values({
        entryId: player.entryId,
        weekId,
        slot: 1,
        teamId: choice.team,
        gameId: choice.game.id,
        source: "player",
        lockAt: new Date(choice.game.kickoff.getTime() - 300_000),
      });
    }

    const report = await processWeekResults(seasonId, weekNumber, config);
    console.log(
      `Week ${weekNumber}: ${report.survived} survived, ${report.rebuysOffered} rebuy offer(s), ${report.eliminated} eliminated`,
    );
  }

  // Give one survivor a tie debt so the multi-pick pick screen is visible.
  const stillAlive = await db
    .select()
    .from(entries)
    .where(and(eq(entries.seasonId, seasonId), eq(entries.status, "active")));
  if (stillAlive[0]) {
    await db.update(entries).set({ requiredPicks: 2 }).where(eq(entries.id, stillAlive[0].id));
  }

  // Have one loser decline their rebuy, so an actual elimination is on show
  // alongside the outstanding offers.
  const pending = await db
    .select()
    .from(entries)
    .where(and(eq(entries.seasonId, seasonId), eq(entries.status, "rebuy_pending")));
  if (pending[0]) {
    const [offer] = await db.select().from(rebuys).where(eq(rebuys.entryId, pending[0].id));
    if (offer) {
      const { declineRebuy } = await import("../src/lib/rebuy-flow");
      await declineRebuy(offer.id, pending[0].id);
    }
  }

  const finalStates = await db
    .select({ status: entries.status, requiredPicks: entries.requiredPicks })
    .from(entries)
    .where(eq(entries.seasonId, seasonId));

  console.log("\n" + "=".repeat(64));
  console.log("  DEMO LEAGUE READY");
  console.log("=".repeat(64));
  console.log(`\n  Sign in at http://localhost:3000/login`);
  console.log(`  Password for EVERY demo account: ${PASSWORD}\n`);
  for (const p of players) {
    const [e] = await db.select().from(entries).where(eq(entries.id, p.entryId));
    console.log(`    ${p.email.padEnd(26)} ${p.name.padEnd(20)} ${e?.status}`);
  }
  console.log(`\n  Alive: ${finalStates.filter((s) => s.status === "active").length}`);
  console.log(`  Rebuy pending: ${finalStates.filter((s) => s.status === "rebuy_pending").length}`);
  console.log(`  Eliminated: ${finalStates.filter((s) => s.status === "eliminated").length}`);
  console.log(`  Awaiting payment: ${finalStates.filter((s) => s.status === "registered").length}`);
  console.log(`\n  Your own admin account still works and is the commissioner here.`);
  console.log(`  Run  npm run demo:clear  to remove it and restore the 2026 season.\n`);

  await rawSql.end();
}

main().catch(async (e) => {
  console.error(e);
  await rawSql.end().catch(() => {});
  process.exit(1);
});
