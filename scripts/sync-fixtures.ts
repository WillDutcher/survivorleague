/**
 * Load the captured ESPN fixtures into the local database.
 *
 * Lets the full sync path — teams, week, games, deadlines, candidate lines — be
 * exercised without network access, which is also how it gets tested. Use the
 * admin "Sync" button for live data.
 *
 *   npm run sync:fixtures
 */

import { eq } from "drizzle-orm";
import { db, sql as rawSql } from "../src/db/client";
import { seasons } from "../src/db/schema";
import { payloadFromScoreboard, payloadFromTeams, syncTeams, syncWeek } from "../src/lib/sync";
import { SEASON_2026 } from "../src/rules/config";
import teamsDocument from "../src/integrations/fixtures/espn-teams.json";
import week1Document from "../src/integrations/fixtures/espn-week1.json";

async function main() {
  const [season] = await db.select().from(seasons).where(eq(seasons.year, 2026)).limit(1);
  if (!season) {
    console.error("No 2026 season found. Run `npm run seed` first.");
    process.exit(1);
  }

  const teamResult = await syncTeams(payloadFromTeams(teamsDocument));
  console.log(`Teams upserted: ${teamResult.teamsUpserted}`);

  const weekResult = await syncWeek(
    season.id,
    2026,
    1,
    (season.rules as typeof SEASON_2026) ?? SEASON_2026,
    payloadFromScoreboard(week1Document),
  );
  console.log(`Games upserted: ${weekResult.gamesUpserted}`);
  console.log(`Candidate lines captured: ${weekResult.linesCaptured}`);
  if (weekResult.exceptions.length) console.log("Exceptions:", weekResult.exceptions);

  await rawSql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
