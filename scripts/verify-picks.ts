/**
 * Exercises pick submission end to end against a disposable entry.
 *
 * Focus is the rule that matters most: a team used once is gone for the season,
 * enforced by the server and not merely hidden in the UI.
 */
import { and, eq } from "drizzle-orm";
import { db, sql as rawSql } from "../src/db/client";
import { entries, games, picks, seasons, users, weeks } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { availabilityFor, loadEntryPickContext, submitPick } from "../src/lib/picks";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";
import type { Game } from "../src/rules/types";

const EMAIL = "pick-probe@example.test";
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function toGames(rows: Array<typeof games.$inferSelect>, week: number): Game[] {
  return rows.map((g) => ({
    id: g.id,
    week,
    awayTeamId: g.awayTeamId,
    homeTeamId: g.homeTeamId,
    kickoff: g.kickoff,
    status: g.status,
    awayScore: g.awayScore,
    homeScore: g.homeScore,
  }));
}

function locks(rows: Array<typeof games.$inferSelect>) {
  return new Map(rows.map((g) => [g.id, new Date(g.kickoff.getTime() - 300_000)]));
}

async function main() {
  const [season] = await db.select().from(seasons).limit(1);
  if (!season) throw new Error("Run `npm run seed` first.");
  const config = (season.rules as SeasonConfig) ?? SEASON_2026;

  await db.delete(users).where(eq(users.email, EMAIL));

  const [user] = await db
    .insert(users)
    .values({
      firstName: "Pick",
      lastName: "Probe",
      email: EMAIL,
      passwordHash: await hashPassword("probe-password-1"),
      dateOfBirth: "1990-01-01",
      stateOfResidence: "VA",
      termsVersionAccepted: "test",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });

  const [entry] = await db
    .insert(entries)
    .values({
      userId: user!.id,
      seasonId: season.id,
      tier: "EIGHTY",
      status: "active",
      requiredPicks: 1,
      includedRebuysRemaining: 3,
    })
    .returning({ id: entries.id });
  const entryId = entry!.id;

  const [w1] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, season.id), eq(weeks.weekNumber, 1)))
    .limit(1);
  const [w2] = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.seasonId, season.id), eq(weeks.weekNumber, 2)))
    .limit(1);

  const w1Rows = await db.select().from(games).where(eq(games.weekId, w1!.id));
  const w2Rows = await db.select().from(games).where(eq(games.weekId, w2!.id));

  const sundayGame = w1Rows.find(
    (g) => g.kickoff.getTime() > new Date("2026-09-13T00:00:00Z").getTime(),
  )!;
  const TEAM = sundayGame.homeTeamId;
  const OPPONENT = sundayGame.awayTeamId;

  const before = new Date("2026-09-01T12:00:00Z");
  const after = new Date("2026-09-20T12:00:00Z");

  console.log("\nPicking");
  let r = await submitPick(entryId, season.id, 1, TEAM, config, before);
  check("accepts a legal first pick", r.ok && r.action === "added", TEAM);

  let ctx = await loadEntryPickContext(entryId, season.id, 1, before);
  check("pick is stored for the week", ctx!.currentWeekPicks.length === 1);
  check("your own current pick stays selectable, so it can be changed",
    availabilityFor(ctx!, toGames(w1Rows, 1), locks(w1Rows), before)
      .find((a) => a.teamId === TEAM)!.available);

  console.log("\nReplacing and removing");
  r = await submitPick(entryId, season.id, 1, OPPONENT, config, before);
  check("choosing another team replaces the pick when one is required", r.ok && r.action === "replaced");
  ctx = await loadEntryPickContext(entryId, season.id, 1, before);
  check("still exactly one pick", ctx!.currentWeekPicks.length === 1);
  check("the new team is the one held", ctx!.currentWeekPicks[0]!.teamId === OPPONENT);

  r = await submitPick(entryId, season.id, 1, OPPONENT, config, before);
  check("clicking your own pick removes it", r.ok && r.action === "removed");
  ctx = await loadEntryPickContext(entryId, season.id, 1, before);
  check("no picks remain after removal", ctx!.currentWeekPicks.length === 0);

  console.log("\nDeadline enforcement");
  r = await submitPick(entryId, season.id, 1, TEAM, config, after);
  check("rejects a pick made after the lock time", !r.ok, r.ok ? "" : r.message);

  console.log("\nNo reuse across weeks — the rule that matters");
  await submitPick(entryId, season.id, 1, TEAM, config, before);

  const w2ctx = await loadEntryPickContext(entryId, season.id, 2, before);
  check("committed team records the week it was used", w2ctx!.committedInWeek.get(TEAM) === 1);

  const w2avail = availabilityFor(w2ctx!, toGames(w2Rows, 2), locks(w2Rows), before);
  const usedRow = w2avail.find((a) => a.teamId === TEAM);
  check("a team used in Week 1 is NOT selectable in Week 2", usedRow ? !usedRow.available : false);
  check("and the reason names Week 1", (usedRow?.explanation ?? "").includes("Week 1"),
    usedRow?.explanation ?? "no explanation");

  const rejected = await submitPick(entryId, season.id, 2, TEAM, config, before);
  check("the SERVER rejects re-picking it, not just the UI", !rejected.ok,
    rejected.ok ? "" : rejected.message);

  const freshTeam = w2Rows.map((g) => g.homeTeamId).find((t) => t !== TEAM)!;
  const accepted = await submitPick(entryId, season.id, 2, freshTeam, config, before);
  check("an unused team is still accepted in Week 2", accepted.ok, freshTeam);

  const finalCtx = await loadEntryPickContext(entryId, season.id, 2, before);
  const selectable = availabilityFor(finalCtx!, toGames(w2Rows, 2), locks(w2Rows), before)
    .filter((a) => a.available).length;
  check("exactly the one burned team is blocked", selectable === 31,
    `${selectable} of 32 selectable`);

  console.log("\nInactive entries");
  await db.update(entries).set({ status: "registered" }).where(eq(entries.id, entryId));
  r = await submitPick(entryId, season.id, 1, OPPONENT, config, before);
  check("rejects picks from an unpaid entry", !r.ok, r.ok ? "" : r.message);
  await db.update(entries).set({ status: "active" }).where(eq(entries.id, entryId));

  console.log("\nMulti-pick week (tie rule)");
  await db.update(entries).set({ requiredPicks: 2 }).where(eq(entries.id, entryId));
  r = await submitPick(entryId, season.id, 1, OPPONENT, config, before);
  check("a second pick is added, not swapped, when two are required", r.ok && r.action === "added");
  ctx = await loadEntryPickContext(entryId, season.id, 1, before);
  check("holds two picks", ctx!.currentWeekPicks.length === 2);
  check("slots are distinct", new Set(ctx!.currentWeekPicks.map((p) => p.slot)).size === 2);

  const third = w1Rows.map((g) => g.homeTeamId).find((t) => t !== TEAM && t !== OPPONENT)!;
  r = await submitPick(entryId, season.id, 1, third, config, before);
  check("refuses a third pick and says to remove one", !r.ok, r.ok ? "" : r.message);

  await db.delete(picks).where(eq(picks.entryId, entryId));
  await db.delete(entries).where(eq(entries.id, entryId));
  await db.delete(users).where(eq(users.id, user!.id));

  console.log(failures === 0 ? "\nAll pick checks passed.\n" : `\n${failures} FAILED\n`);
  await rawSql.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
