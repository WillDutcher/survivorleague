/**
 * Exercises the weekly processing path against REAL completed games.
 *
 * Uses actual 2025 Week 18 results, so "did this pick win" is checked against
 * what genuinely happened rather than against numbers invented to make the test
 * pass. This is the code that eliminates people; it gets the harshest check.
 */
import { and, eq, like } from "drizzle-orm";
import { db, sql as rawSql } from "../src/db/client";
import {
  entries,
  games,
  oddsSnapshots,
  picks,
  rebuys,
  seasons,
  users,
  weeks,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { assignDefaultPicks, processWeekResults } from "../src/lib/processing";
import { payloadFromScoreboard, syncWeek } from "../src/lib/sync";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";
import week18 from "../src/integrations/fixtures/espn-2025-week18.json";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const TEST_YEAR = 2025;
const WEEK = 18;
let seasonId = "";

async function cleanup() {
  const [s] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.year, TEST_YEAR), eq(seasons.mode, "practice")))
    .limit(1);
  if (!s) return;
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
  // Probe accounts are disposable and must not accumulate in the database.
  await db.delete(users).where(like(users.email, "probe-%@example.test"));
}

let probeCount = 0;
async function makeEntry(label: string, tier: "TWENTY" | "EIGHTY", requiredPicks = 1) {
  probeCount += 1;
  const [u] = await db
    .insert(users)
    .values({
      firstName: label,
      lastName: "Probe",
      email: `probe-${probeCount}-${Date.now()}@example.test`,
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
      tier,
      status: "active",
      requiredPicks,
      includedRebuysRemaining: tier === "EIGHTY" ? 3 : 0,
    })
    .returning({ id: entries.id });

  return e!.id;
}

async function main() {
  await cleanup();
  const config: SeasonConfig = { ...SEASON_2026, year: TEST_YEAR, mode: "practice" };

  const [season] = await db
    .insert(seasons)
    .values({
      year: TEST_YEAR,
      name: "Results probe",
      mode: "practice",
      registrationOpen: false,
      rules: config,
    })
    .returning({ id: seasons.id });
  seasonId = season!.id;

  await syncWeek(seasonId, TEST_YEAR, WEEK, config, payloadFromScoreboard(week18));

  const [week] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, WEEK)))
    .limit(1);
  const weekGames = await db.select().from(games).where(eq(games.weekId, week!.id));

  check("real completed games synced", weekGames.length === 16, `${weekGames.length} games`);
  check("all are final", weekGames.every((g) => g.status === "final"));
  check("final scores present", weekGames.every((g) => g.homeScore !== null && g.awayScore !== null));

  const decisive = weekGames.find((g) => g.homeScore !== g.awayScore)!;
  const realWinner =
    decisive.homeScore! > decisive.awayScore! ? decisive.homeTeamId : decisive.awayTeamId;
  const realLoser =
    decisive.homeScore! > decisive.awayScore! ? decisive.awayTeamId : decisive.homeTeamId;

  console.log(
    `\nReal game used: ${decisive.awayTeamId} ${decisive.awayScore} @ ${decisive.homeTeamId} ${decisive.homeScore} — winner ${realWinner}\n`,
  );

  const lockAt = new Date(decisive.kickoff.getTime() - 300_000);

  console.log("Grading against reality");
  const winnerEntry = await makeEntry("Winner", "EIGHTY");
  const loserEntry = await makeEntry("Loser", "EIGHTY");

  await db.insert(picks).values({
    entryId: winnerEntry, weekId: week!.id, slot: 1,
    teamId: realWinner, gameId: decisive.id, source: "player", lockAt,
  });
  await db.insert(picks).values({
    entryId: loserEntry, weekId: week!.id, slot: 1,
    teamId: realLoser, gameId: decisive.id, source: "player", lockAt,
  });

  let report = await processWeekResults(seasonId, WEEK, config);
  check("processing ran", report.ran);

  const [winnerAfter] = await db.select().from(entries).where(eq(entries.id, winnerEntry));
  const [loserAfter] = await db.select().from(entries).where(eq(entries.id, loserEntry));

  check("the team that actually won survives", winnerAfter!.status === "active");
  check("survivor's requirement returns to 1", winnerAfter!.requiredPicks === 1);

  // A Week 18 loss is past every rebuy window (D20): the $80 tier covers losses
  // only through Week 8, so elimination here is correct, not a bug.
  check("a Week 18 loss eliminates even on the $80 tier — rebuys expired at Week 8",
    loserAfter!.status === "eliminated", loserAfter!.status);
  const w18Rebuys = await db.select().from(rebuys).where(eq(rebuys.entryId, loserEntry));
  check("and no rebuy is offered for it", w18Rebuys.length === 0);

  const gradedPicks = await db.select().from(picks).where(eq(picks.weekId, week!.id));
  check("winning pick graded win", gradedPicks.find((p) => p.entryId === winnerEntry)!.outcome === "win");
  check("losing pick graded loss", gradedPicks.find((p) => p.entryId === loserEntry)!.outcome === "loss");

  console.log("\nRebuy windows, at weeks where they apply (D20)");

  async function lossInWeek(weekNumber: number, tier: "TWENTY" | "EIGHTY", label: string) {
    const [w] = await db
      .insert(weeks)
      .values({ seasonId, weekNumber })
      .onConflictDoUpdate({ target: [weeks.seasonId, weeks.weekNumber], set: { seasonId } })
      .returning({ id: weeks.id });

    const [g] = await db
      .insert(games)
      .values({
        weekId: w!.id,
        providerGameId: `probe-loss-${weekNumber}-${tier}`,
        awayTeamId: "DAL",
        homeTeamId: "PHI",
        kickoff: new Date("2025-10-05T17:00:00Z"),
        status: "final",
        awayScore: 10,
        homeScore: 30,
      })
      .returning({ id: games.id });

    const entryId = await makeEntry(label, tier);
    await db.insert(picks).values({
      entryId, weekId: w!.id, slot: 1,
      teamId: "DAL", // lost 10-30
      gameId: g!.id, source: "player",
      lockAt: new Date("2025-10-05T16:55:00Z"),
    });

    await processWeekResults(seasonId, weekNumber, config);
    const [after] = await db.select().from(entries).where(eq(entries.id, entryId));
    const [offer] = await db.select().from(rebuys).where(eq(rebuys.entryId, entryId));
    return { entryId, status: after!.status, offer };
  }

  const eightyWk4 = await lossInWeek(4, "EIGHTY", "EightyFour");
  check("$80 loss in Week 4 is offered an included rebuy",
    eightyWk4.status === "rebuy_pending" && eightyWk4.offer?.kind === "included", eightyWk4.status);
  check("and it costs nothing", eightyWk4.offer?.priceCents === 0);

  const twentyWk1 = await lossInWeek(1, "TWENTY", "TwentyOne");
  check("$20 loss in Week 1 costs $10", twentyWk1.offer?.priceCents === 1000,
    String(twentyWk1.offer?.priceCents));

  const twentyWk4 = await lossInWeek(4, "TWENTY", "TwentyFour");
  check("$20 loss in Week 4 costs $30", twentyWk4.offer?.priceCents === 3000,
    String(twentyWk4.offer?.priceCents));

  const twentyWk6 = await lossInWeek(6, "TWENTY", "TwentySix");
  check("$20 loss in Week 6 eliminates — no rebuys after Week 5",
    twentyWk6.status === "eliminated" && !twentyWk6.offer, twentyWk6.status);

  const eightyWk9 = await lossInWeek(9, "EIGHTY", "EightyNine");
  check("$80 loss in Week 9 eliminates — unused rebuys expired after Week 8",
    eightyWk9.status === "eliminated" && !eightyWk9.offer, eightyWk9.status);

  console.log("\nIdempotency");
  const rebuysBefore = (await db.select().from(rebuys)).length;
  report = await processWeekResults(seasonId, WEEK, config);
  const rebuysAfter = (await db.select().from(rebuys)).length;
  check("re-running processes nothing new", report.entriesProcessed === 0);
  check("no duplicate rebuy charge", rebuysBefore === rebuysAfter, `${rebuysBefore} -> ${rebuysAfter}`);

  console.log("\nWeek 18 tie is a loss (D17a)");
  const tieGame = weekGames.find((g) => g.id !== decisive.id)!;
  await db.update(games).set({ homeScore: 20, awayScore: 20 }).where(eq(games.id, tieGame.id));

  const tieEntry = await makeEntry("Tier", "TWENTY");
  await db.insert(picks).values({
    entryId: tieEntry, weekId: week!.id, slot: 1,
    teamId: tieGame.homeTeamId, gameId: tieGame.id, source: "player",
    lockAt: new Date(tieGame.kickoff.getTime() - 300_000),
  });

  await processWeekResults(seasonId, WEEK, config);
  const [tieAfter] = await db.select().from(entries).where(eq(entries.id, tieEntry));
  check("a tie in the final week eliminates, it does not double",
    tieAfter!.status === "eliminated", tieAfter!.status);

  console.log("\nTie in a normal week doubles the requirement (D17)");
  const [w10] = await db.insert(weeks).values({ seasonId, weekNumber: 10 }).returning({ id: weeks.id });
  const [tieGame10] = await db
    .insert(games)
    .values({
      weekId: w10!.id, providerGameId: "probe-tie-10",
      awayTeamId: "NYG", homeTeamId: "WSH",
      kickoff: new Date("2025-11-09T18:00:00Z"),
      status: "final", awayScore: 21, homeScore: 21,
    })
    .returning({ id: games.id });

  const doubler = await makeEntry("Doubler", "EIGHTY");
  await db.insert(picks).values({
    entryId: doubler, weekId: w10!.id, slot: 1,
    teamId: "WSH", gameId: tieGame10!.id, source: "player",
    lockAt: new Date("2025-11-09T17:55:00Z"),
  });

  await processWeekResults(seasonId, 10, config);
  const [doublerAfter] = await db.select().from(entries).where(eq(entries.id, doubler));
  check("tie survives in a normal week", doublerAfter!.status === "active", doublerAfter!.status);
  check("and next week requires 2 picks", doublerAfter!.requiredPicks === 2,
    String(doublerAfter!.requiredPicks));

  console.log("\nUnfinished games are never processed");
  const [w11] = await db.insert(weeks).values({ seasonId, weekNumber: 11 }).returning({ id: weeks.id });
  const [pendingGame] = await db
    .insert(games)
    .values({
      weekId: w11!.id, providerGameId: "probe-pending-11",
      awayTeamId: "DAL", homeTeamId: "PHI",
      kickoff: new Date("2025-11-16T18:00:00Z"),
      status: "scheduled", awayScore: null, homeScore: null,
    })
    .returning({ id: games.id });

  const waiting = await makeEntry("Waiting", "EIGHTY");
  await db.insert(picks).values({
    entryId: waiting, weekId: w11!.id, slot: 1, teamId: "PHI", gameId: pendingGame!.id,
    source: "player", lockAt: new Date("2025-11-16T17:55:00Z"),
  });

  report = await processWeekResults(seasonId, 11, config);
  const [waitingAfter] = await db.select().from(entries).where(eq(entries.id, waiting));
  check("entry with an unfinished game is left untouched", waitingAfter!.status === "active");
  check("and is reported as pending", report.pending === 1, String(report.pending));

  console.log("\nDefault picks refuse to run on unlocked lines");
  const defaults = await assignDefaultPicks(seasonId, WEEK, config);
  check("refuses without locked league lines", !defaults.ran);

  await cleanup();
  console.log(failures === 0 ? "\nAll results checks passed.\n" : `\n${failures} FAILED\n`);
  await rawSql.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
