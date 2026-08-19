/**
 * Seed a season and mint a bootstrap invite.
 *
 * Solves the chicken-and-egg problem: signup requires an invite (D7), invites
 * are issued by confirmed players, and at the start there are none. This creates
 * the season and one admin invite, then prints the signup URL.
 *
 *   npm run seed              seed a live 2026 season
 *   npm run seed -- practice  seed a practice season instead (D12)
 *
 * Safe to run repeatedly: it will not duplicate a season, and it mints a fresh
 * invite each time so you can always get back in.
 */

import { eq, and } from "drizzle-orm";
import { db, sql as rawSql } from "../src/db/client";
import { invites, seasons } from "../src/db/schema";
import { SEASON_2026 } from "../src/rules/config";
import type { SeasonConfig } from "../src/rules/config";

async function main() {
  const mode = process.argv.includes("practice") ? "practice" : "live";
  const config: SeasonConfig = { ...SEASON_2026, mode };

  const existing = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.year, config.year), eq(seasons.mode, mode)))
    .limit(1);

  let seasonId: string;

  if (existing[0]) {
    seasonId = existing[0].id;
    console.log(`Season ${config.year} (${mode}) already exists — reusing it.`);
  } else {
    const [created] = await db
      .insert(seasons)
      .values({
        year: config.year,
        name: `${config.year} Survivor League${mode === "practice" ? " (practice)" : ""}`,
        mode,
        registrationOpen: true,
        rules: config,
        playerInvitesEnabled: true,
      })
      .returning({ id: seasons.id });

    seasonId = created?.id ?? "";
    console.log(`Created season ${config.year} (${mode}).`);
  }

  // A multi-use, long-lived invite so the commissioner can always get in and
  // can hand the same link to the first few players.
  const token = (await import("node:crypto")).randomBytes(18).toString("base64url");
  await db.insert(invites).values({
    token,
    seasonId,
    createdByUserId: null,
    maxUses: 25,
    expiresAt: new Date(Date.now() + 90 * 86_400_000),
    note: "Bootstrap invite created by seed script",
  });

  const url = `http://localhost:3000/join/${token}`;

  console.log("");
  console.log("  Bootstrap invite ready. Sign up here:");
  console.log("");
  console.log(`    ${url}`);
  console.log("");
  console.log("  Good for 25 signups over the next 90 days.");
  console.log("  The FIRST account created becomes the commissioner (admin).");
  console.log("");

  await rawSql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
