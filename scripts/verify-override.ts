/**
 * Commissioner pick override, against a disposable season.
 *
 * The point of these checks is the REFUSALS. An override that works is easy;
 * what matters is that it cannot be used to break no-reuse, cannot rewrite a
 * graded week, and never lands without an audit row.
 */
import { and, eq, like } from "drizzle-orm";
import { db } from "../src/db/client";
import { auditEvents, entries, games, picks, seasons, users, weeks } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { loadOverrideContext, overridePick } from "../src/lib/pick-override";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const YEAR = 2023;

async function cleanup() {
  const [s] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.year, YEAR), eq(seasons.mode, "practice")))
    .limit(1);
  if (s) {
    const ws = await db.select().from(weeks).where(eq(weeks.seasonId, s.id));
    for (const w of ws) {
      await db.delete(picks).where(eq(picks.weekId, w.id));
      await db.delete(games).where(eq(games.weekId, w.id));
    }
    await db.delete(entries).where(eq(entries.seasonId, s.id));
    await db.delete(weeks).where(eq(weeks.seasonId, s.id));
    await db.delete(seasons).where(eq(seasons.id, s.id));
  }
  const probes = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "ov-%@example.test"));
  for (const p of probes) await db.delete(auditEvents).where(eq(auditEvents.actorUserId, p.id));
  await db.delete(users).where(like(users.email, "ov-%@example.test"));
}

async function main() {
  await cleanup();
  const config: SeasonConfig = { ...SEASON_2026, year: YEAR, mode: "live" };

  const [season] = await db
    .insert(seasons)
    .values({
      year: YEAR,
      name: "Override probe",
      mode: "practice",
      registrationOpen: false,
      rules: config,
      currentWeek: 1,
    })
    .returning({ id: seasons.id });
  const seasonId = season!.id;

  const [w1] = await db
    .insert(weeks)
    .values({ seasonId, weekNumber: 1, sundayDeadlineAt: new Date(Date.now() + 3 * 3600_000) })
    .returning({ id: weeks.id });
  const [w2] = await db
    .insert(weeks)
    .values({ seasonId, weekNumber: 2, sundayDeadlineAt: new Date(Date.now() + 7 * 86_400_000) })
    .returning({ id: weeks.id });

  // One game already under way, one still to come.
  const [started] = await db
    .insert(games)
    .values({
      weekId: w1!.id,
      providerGameId: `ov-a-${Date.now()}`,
      awayTeamId: "PHI",
      homeTeamId: "DAL",
      kickoff: new Date(Date.now() - 3600_000),
      status: "in_progress",
    })
    .returning({ id: games.id });
  const [later] = await db
    .insert(games)
    .values({
      weekId: w1!.id,
      providerGameId: `ov-b-${Date.now()}`,
      awayTeamId: "KC",
      homeTeamId: "BUF",
      kickoff: new Date(Date.now() + 4 * 3600_000),
      status: "scheduled",
    })
    .returning({ id: games.id });
  const [wk2game] = await db
    .insert(games)
    .values({
      weekId: w2!.id,
      providerGameId: `ov-c-${Date.now()}`,
      awayTeamId: "KC",
      homeTeamId: "MIA",
      kickoff: new Date(Date.now() + 8 * 86_400_000),
      status: "scheduled",
    })
    .returning({ id: games.id });

  const [u] = await db
    .insert(users)
    .values({
      firstName: "Otto",
      lastName: "Probe",
      email: `ov-1-${Date.now()}@example.test`,
      passwordHash: await hashPassword("probe-password-1"),
      dateOfBirth: "1990-01-01",
      stateOfResidence: "VA",
      termsVersionAccepted: "test",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  const [admin] = await db
    .insert(users)
    .values({
      firstName: "Comm",
      lastName: "Probe",
      email: `ov-2-${Date.now()}@example.test`,
      passwordHash: await hashPassword("probe-password-1"),
      isAdmin: true,
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
      tier: "EIGHTY",
      status: "active",
      requiredPicks: 1,
      includedRebuysRemaining: 3,
    })
    .returning({ id: entries.id });
  const entryId = e!.id;

  const base = {
    entryId,
    weekNumber: 1,
    reason: "computer froze at 12:56",
    actorUserId: admin!.id,
  };

  console.log("\nGuards");
  let r = await overridePick(seasonId, config, {
    ...base,
    teamId: "PHI",
    gameId: started!.id,
    reason: "x",
  });
  check("a reason under 3 characters is refused", !r.ok, r.message);

  r = await overridePick(seasonId, config, { ...base, teamId: "KC", gameId: started!.id });
  check("a team not in the chosen game is refused", !r.ok, r.message);

  r = await overridePick(seasonId, config, {
    ...base,
    weekNumber: 9,
    teamId: "PHI",
    gameId: started!.id,
  });
  check("an unloaded week is refused", !r.ok, r.message);

  console.log("\nSetting a pick for someone who has none");
  r = await overridePick(seasonId, config, { ...base, teamId: "PHI", gameId: started!.id });
  check("the commissioner can set it", r.ok, r.message);
  check("and is told the game already started", r.message.includes("kicked off"), r.message);

  let [row] = await db.select().from(picks).where(eq(picks.entryId, entryId));
  check(
    "the pick is attributed to the commissioner, not the player",
    row!.source === "commissioner",
    row!.source,
  );

  let audits = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, "pick"), eq(auditEvents.actorUserId, admin!.id)));
  check("an audit row was written", audits.length === 1, String(audits.length));
  check("carrying the stated reason", audits[0]!.reason === "computer froze at 12:56");

  console.log("\nChanging a pick that exists");
  r = await overridePick(seasonId, config, { ...base, teamId: "DAL", gameId: started!.id });
  check("the pick can be changed", r.ok, r.message);
  [row] = await db.select().from(picks).where(eq(picks.entryId, entryId));
  check("the team actually changed", row!.teamId === "DAL", row!.teamId);

  audits = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, "pick"), eq(auditEvents.actorUserId, admin!.id)));
  const withBefore = audits.find((a) => a.before !== null);
  check(
    "the audit records what it was before",
    Boolean(withBefore),
    JSON.stringify(withBefore?.before ?? null),
  );

  console.log("\nNo-reuse is not overridable");
  await db.insert(picks).values({
    entryId,
    weekId: w2!.id,
    slot: 1,
    teamId: "KC",
    gameId: wk2game!.id,
    source: "player",
    lockAt: new Date(Date.now() + 7 * 86_400_000),
  });
  r = await overridePick(seasonId, config, { ...base, teamId: "KC", gameId: later!.id });
  check("a team already used in another week is refused", !r.ok, r.message);

  console.log("\nGrading closes the window");
  await db.update(weeks).set({ resultsProcessedAt: new Date() }).where(eq(weeks.id, w1!.id));
  r = await overridePick(seasonId, config, { ...base, teamId: "PHI", gameId: started!.id });
  check("a graded week is refused", !r.ok, r.message);

  await db.update(weeks).set({ resultsProcessedAt: null }).where(eq(weeks.id, w1!.id));
  await db.update(picks).set({ outcome: "win" }).where(eq(picks.weekId, w1!.id));
  r = await overridePick(seasonId, config, { ...base, teamId: "PHI", gameId: started!.id });
  check("a graded PICK is refused even when the week is not marked", !r.ok, r.message);

  console.log("\nForm context");
  const ctx = await loadOverrideContext(seasonId, 1, config);
  check("active players are offered", ctx.entries.length === 1, String(ctx.entries.length));
  check("their current pick is shown", ctx.entries[0]!.currentPicks.length === 1);
  check("both games are offered", ctx.games.length === 2, String(ctx.games.length));
  check("the game under way is flagged", ctx.games.some((g) => g.kickedOff));

  await cleanup();
  console.log(failures === 0 ? "\nAll override checks passed.\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
