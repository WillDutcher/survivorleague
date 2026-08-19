/**
 * Season and entry queries.
 *
 * Thin data access around the rule engine. Nothing here decides a league
 * outcome; it assembles the plain data the pure functions in src/rules operate
 * on, and writes back what they return.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { entries, payments, seasons, users } from "@/db/schema";
import { SEASON_2026, tierConfig, type SeasonConfig } from "@/rules/config";
import { potCents, type PaymentRecord } from "@/rules/settlement";
import type { EntryTier } from "@/rules/types";

export interface SeasonRow {
  id: string;
  isActive?: boolean;
  /** 1 = preseason, 2 = regular season. */
  seasonType: number;
  year: number;
  name: string;
  mode: "practice" | "live";
  registrationOpen: boolean;
  currentWeek: number | null;
  playerInvitesEnabled: boolean;
  showTeamLogos: boolean;
  config: SeasonConfig;
}

/**
 * The season the app is currently operating.
 *
 * Prefers the season explicitly flagged active; falls back to the newest year so
 * a fresh install works before anyone has chosen one.
 */
export async function currentSeason(): Promise<SeasonRow | null> {
  const [flagged] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
  const [newest] = flagged
    ? [flagged]
    : await db.select().from(seasons).orderBy(sql`${seasons.year} desc`).limit(1);
  const row = newest;
  if (!row) return null;

  return {
    id: row.id,
    year: row.year,
    name: row.name,
    mode: row.mode,
    registrationOpen: row.registrationOpen,
    currentWeek: row.currentWeek,
    playerInvitesEnabled: row.playerInvitesEnabled,
    showTeamLogos: row.showTeamLogos,
    isActive: row.isActive,
    seasonType: row.seasonType,
    // Fall back to the compiled defaults if the stored blob is ever unreadable,
    // so a bad row cannot take the whole app down mid-season.
    config: (row.rules as SeasonConfig | null) ?? SEASON_2026,
  };
}

export interface EntryRow {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  tier: EntryTier;
  status: string;
  requiredPicks: number;
  includedRebuysRemaining: number;
  amountPaidCents: number;
  amountOwedCents: number;
}

export async function entryForUser(userId: string, seasonId: string): Promise<EntryRow | null> {
  const rows = await listEntries(seasonId, userId);
  return rows[0] ?? null;
}

/**
 * Entries with their payment totals.
 *
 * `amountOwedCents` is what the player still needs to send before their entry
 * counts. It drives both the player's own "you are not in yet" banner and the
 * commissioner's payment queue (D9).
 */
export async function listEntries(seasonId: string, onlyUserId?: string): Promise<EntryRow[]> {
  const season = await currentSeason();
  const config = season?.config ?? SEASON_2026;

  const where = onlyUserId
    ? and(eq(entries.seasonId, seasonId), eq(entries.userId, onlyUserId))
    : eq(entries.seasonId, seasonId);

  const rows = await db
    .select({
      id: entries.id,
      userId: entries.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      tier: entries.tier,
      status: entries.status,
      requiredPicks: entries.requiredPicks,
      includedRebuysRemaining: entries.includedRebuysRemaining,
      paid: sql<number>`coalesce(sum(case when ${payments.status} = 'verified' then ${payments.amountCents} else 0 end), 0)::int`,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .leftJoin(payments, eq(payments.entryId, entries.id))
    .where(where)
    .groupBy(
      entries.id,
      users.firstName,
      users.lastName,
      users.email,
      entries.tier,
      entries.status,
      entries.requiredPicks,
      entries.includedRebuysRemaining,
    )
    .orderBy(asc(users.lastName), asc(users.firstName));

  return rows.map((r) => {
    // Practice seasons cost nothing (D12).
    const due = season?.mode === "practice" ? 0 : tierConfig(config, r.tier).entryFeeCents;
    return {
      id: r.id,
      userId: r.userId,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      tier: r.tier,
      status: r.status,
      requiredPicks: r.requiredPicks,
      includedRebuysRemaining: r.includedRebuysRemaining,
      amountPaidCents: r.paid,
      amountOwedCents: Math.max(0, due - r.paid),
    };
  });
}

/** Current pot: verified payments only (D6). */
export async function seasonPotCents(seasonId: string): Promise<number> {
  const season = await currentSeason();
  const rows = await db
    .select({
      entryId: payments.entryId,
      category: payments.category,
      amountCents: payments.amountCents,
      status: payments.status,
    })
    .from(payments)
    .where(eq(payments.seasonId, seasonId));

  return potCents(rows as PaymentRecord[], season?.config ?? SEASON_2026);
}

export function formatMoney(cents: number): string {
  return cents % 100 === 0
    ? `$${(cents / 100).toLocaleString()}`
    : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export function tierLabel(config: SeasonConfig, tier: EntryTier): string {
  return tierConfig(config, tier).label;
}

// Week naming is pure league logic and lives in the rule engine; re-exported
// here so callers have one obvious import for season display helpers.
export { weekLabel, weekLabelShort, PRESEASON_LAST_API_WEEK } from "@/rules/weeks";
