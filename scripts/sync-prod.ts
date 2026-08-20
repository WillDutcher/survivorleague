/**
 * Sync NFL data from THIS machine straight into the production database.
 *
 *   npm run sync:prod            sync the season's current week
 *   npm run sync:prod -- 3       sync a specific week
 *   npm run sync:prod -- 3 lock  sync it and lock the league lines
 *
 * Why this exists: ESPN returns 403 to Vercel. The endpoints are public and
 * unauthenticated, but ESPN filters who may call them, and a datacentre IP does
 * not qualify. A home connection does. So the same sync code runs here and
 * writes to the same Neon database the deployed app reads.
 *
 * This is a real fallback, not a workaround for laziness -- if ESPN keeps
 * refusing Vercel, the weekly sync has to originate somewhere it will talk to.
 */

import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { seasons, weeks } from "../src/db/schema";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";

const url = process.env.PRODUCTION_DATABASE_URL;
if (!url) {
  console.error("PRODUCTION_DATABASE_URL is not set in .env.local.");
  process.exit(1);
}

// Point the shared db client at production for the duration of this script.
process.env.DATABASE_URL = url;

const sql = postgres(url, { max: 1, ssl: "require" });
const db = drizzle(sql, { schema });

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const wantsAll = args.includes("all");
  const rangeArg = args.find((a) => /^\d+-\d+$/.test(a));
  const weekArg = args.find((a) => /^\d+$/.test(a));
  const shouldLock = args.includes("lock");

  const [season] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
  if (!season) {
    console.error("No active season in production. Run the seed first.");
    process.exit(1);
  }

  const config = (season.rules as SeasonConfig) ?? SEASON_2026;
  const seasonType = season.seasonType === 1 ? 1 : 2;
  // Preseason is API weeks 1-4; the regular season runs to config.finalWeek.
  const lastWeek = seasonType === 1 ? 4 : config.finalWeek;

  let targets: number[];
  if (wantsAll) {
    targets = Array.from({ length: lastWeek }, (_, i) => i + 1);
  } else if (rangeArg) {
    const [from, to] = rangeArg.split("-").map(Number) as [number, number];
    targets = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  } else {
    targets = [weekArg ? Number(weekArg) : (season.currentWeek ?? 1)];
  }

  console.log(`\n${season.name}  (${season.mode}, seasontype ${seasonType})`);
  console.log(
    `Syncing ${
      targets.length === 1 ? `week ${targets[0]}` : `weeks ${targets[0]}-${targets.at(-1)}`
    } from ESPN into PRODUCTION...\n`,
  );

  // Imported lazily so the DATABASE_URL override above is already in place.
  const { syncTeams, syncWeek, lockLeagueLines } = await import("../src/lib/sync");

  const teamResult = await syncTeams();
  console.log(`  teams upserted:  ${teamResult.teamsUpserted}\n`);

  let totalGames = 0;
  let totalLines = 0;
  const problems: string[] = [];

  for (const weekNumber of targets) {
    try {
      const weekResult = await syncWeek(
        season.id,
        season.year,
        weekNumber,
        config,
        undefined,
        seasonType,
      );
      totalGames += weekResult.gamesUpserted;
      totalLines += weekResult.linesCaptured ?? 0;
      console.log(
        `  week ${String(weekNumber).padStart(2)}:  ${String(weekResult.gamesUpserted).padStart(2)} games, ${String(weekResult.linesCaptured ?? 0).padStart(2)} lines`,
      );
      for (const e of weekResult.exceptions) problems.push(`week ${weekNumber}: ${e}`);

      if (shouldLock) {
        const [week] = await db
          .select()
          .from(weeks)
          .where(and(eq(weeks.seasonId, season.id), eq(weeks.weekNumber, weekNumber)))
          .limit(1);
        if (week) {
          const locked = await lockLeagueLines(week.id, "00000000-0000-0000-0000-000000000000");
          console.log(`            lines locked: ${locked.locked}`);
          if (locked.missing.length) {
            problems.push(`week ${weekNumber} no line: ${locked.missing.join(", ")}`);
          }
        }
      }
    } catch (error) {
      // One bad week must not abandon the rest of the season.
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  week ${String(weekNumber).padStart(2)}:  FAILED — ${message}`);
      problems.push(`week ${weekNumber}: ${message}`);
    }
  }

  console.log(`\n  total: ${totalGames} games, ${totalLines} candidate lines`);
  if (problems.length) {
    console.log("\n  problems:");
    for (const p of problems) console.log("    - " + p);
  }

  console.log("\nDone. The deployed app reads the same database, so this is live now.\n");
  await sql.end();
}

main().catch(async (error) => {
  console.error("\nSync failed: " + (error instanceof Error ? error.message : String(error)));
  await sql.end().catch(() => {});
  process.exit(1);
});
