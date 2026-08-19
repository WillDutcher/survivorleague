/** Confirms a preseason season syncs exhibition games and never the real ones. */
import { and, eq } from "drizzle-orm";
import { db, sql as rawSql } from "../src/db/client";
import { games, oddsSnapshots, seasons, weeks } from "../src/db/schema";
import { payloadFromScoreboard, syncWeek } from "../src/lib/sync";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";
import preseason3 from "../src/integrations/fixtures/espn-preseason-week3.json";
import regular1 from "../src/integrations/fixtures/espn-week1.json";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const YEAR = 2022;

async function cleanup() {
  const [s] = await db.select().from(seasons)
    .where(and(eq(seasons.year, YEAR), eq(seasons.mode, "practice"))).limit(1);
  if (!s) return;
  const ws = await db.select().from(weeks).where(eq(weeks.seasonId, s.id));
  for (const w of ws) {
    const gs = await db.select().from(games).where(eq(games.weekId, w.id));
    for (const g of gs) await db.delete(oddsSnapshots).where(eq(oddsSnapshots.gameId, g.id));
    await db.delete(games).where(eq(games.weekId, w.id));
  }
  await db.delete(weeks).where(eq(weeks.seasonId, s.id));
  await db.delete(seasons).where(eq(seasons.id, s.id));
}

async function main() {
  await cleanup();
  const config: SeasonConfig = { ...SEASON_2026, year: YEAR, mode: "practice", finalWeek: 4 };

  const [season] = await db.insert(seasons).values({
    year: YEAR, name: "Preseason probe", mode: "practice",
    seasonType: 1, rules: config, registrationOpen: true,
  }).returning({ id: seasons.id });

  await syncWeek(season!.id, YEAR, 3, config, payloadFromScoreboard(preseason3), 1);

  const [w] = await db.select().from(weeks)
    .where(and(eq(weeks.seasonId, season!.id), eq(weeks.weekNumber, 3))).limit(1);
  const gs = await db.select().from(games).where(eq(games.weekId, w!.id));

  check("preseason games sync", gs.length > 0, `${gs.length} games`);

  const lvHou = gs.find((g) => g.awayTeamId === "LV" && g.homeTeamId === "HOU");
  check("the LV at HOU preseason game is present", Boolean(lvHou));

  const regularIds = new Set(
    payloadFromScoreboard(regular1).games.map((g) => g.providerGameId),
  );
  check("no regular-season game leaked in",
    gs.every((g) => !regularIds.has(g.providerGameId)));

  const lines = await db.select().from(oddsSnapshots);
  const hou = lines.find((l) => l.favoriteTeamId === "HOU");
  check("preseason lines are captured too", Boolean(hou), hou ? `HOU -${hou.spread}` : "none");

  check("preseason config caps the season at week 4", config.finalWeek === 4);
  check("preseason is forced to practice mode — no money", config.mode === "practice");

  await cleanup();
  console.log(failures === 0 ? "\nPreseason checks passed.\n" : `\n${failures} FAILED\n`);
  await rawSql.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
