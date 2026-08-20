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
  const weekArg = args.find((a) => /^\d+$/.test(a));
  const shouldLock = args.includes("lock");

  const [season] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
  if (!season) {
    console.error("No active season in production. Run the seed first.");
    process.exit(1);
  }

  const config = (season.rules as SeasonConfig) ?? SEASON_2026;
  const weekNumber = weekArg ? Number(weekArg) : (season.currentWeek ?? 1);
  const seasonType = season.seasonType === 1 ? 1 : 2;

  console.log(`\n${season.name}  (${season.mode}, seasontype ${seasonType})`);
  console.log(`Syncing week ${weekNumber} from ESPN into PRODUCTION...\n`);

  // Imported lazily so the DATABASE_URL override above is already in place.
  const { syncTeams, syncWeek, lockLeagueLines } = await import("../src/lib/sync");

  const teamResult = await syncTeams();
  console.log(`  teams upserted:  ${teamResult.teamsUpserted}`);

  const weekResult = await syncWeek(
    season.id,
    season.year,
    weekNumber,
    config,
    undefined,
    seasonType,
  );
  console.log(`  games upserted:  ${weekResult.gamesUpserted}`);
  console.log(`  lines captured:  ${weekResult.linesCaptured}`);
  if (weekResult.exceptions.length) {
    console.log("  exceptions:");
    for (const e of weekResult.exceptions) console.log("    - " + e);
  }

  if (shouldLock) {
    const [week] = await db
      .select()
      .from(weeks)
      .where(and(eq(weeks.seasonId, season.id), eq(weeks.weekNumber, weekNumber)))
      .limit(1);
    if (week) {
      const locked = await lockLeagueLines(week.id, "00000000-0000-0000-0000-000000000000");
      console.log(`  league lines locked: ${locked.locked}`);
      if (locked.missing.length) {
        console.log("  NO LINE for: " + locked.missing.join(", "));
      }
    }
  }

  console.log("\nDone. The deployed app reads the same database, so this is live now.\n");
  await sql.end();
}

main().catch(async (error) => {
  console.error("\nSync failed: " + (error instanceof Error ? error.message : String(error)));
  await sql.end().catch(() => {});
  process.exit(1);
});
