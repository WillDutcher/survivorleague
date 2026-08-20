/**
 * Settlement and the payout checklist.
 *
 * The app computes who is owed what and holds the consent trail. It never moves
 * money (D22): disbursement is manual, by the commissioner, exactly like
 * collection. These rows are a checklist and a record, not an instruction to
 * any payment API.
 *
 * The arithmetic itself is not here — `settleSeason` and `splitEvenly` live in
 * the pure rule engine, where they are tested across a sweep of pot sizes and
 * survivor counts to prove the parts always sum back to the whole. A vanishing
 * remainder would be arithmetically indistinguishable from a rake, which
 * matters a great deal given that the commissioner takes nothing (D33).
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, entries, payouts, seasons, users } from "@/db/schema";
import { seasonPotCents } from "@/lib/season";
import { survivorsFor } from "@/lib/splits";
import { settleSeason } from "@/rules/settlement";
import type { SeasonConfig } from "@/rules/config";
import type { EntryId } from "@/rules/types";

export interface PayoutRow {
  id: string;
  entryId: string;
  name: string;
  email: string;
  amountCents: number;
  basis: string;
  paidOutAt: Date | null;
  paidOutReference: string | null;
}

export interface SettleResult {
  ok: boolean;
  message: string;
}

/**
 * Create the payout rows for a finished season.
 *
 * Refuses when payouts already exist rather than adding a second set — being
 * run twice must never double the money owed. Correcting a settlement is a
 * deliberate act, not a retry.
 */
export async function settleSeasonNow(
  seasonId: string,
  config: SeasonConfig,
  weekJustCompleted: number,
  actorUserId: string,
): Promise<SettleResult> {
  const existing = await db.select({ id: payouts.id }).from(payouts).where(eq(payouts.seasonId, seasonId));
  if (existing.length > 0) {
    return {
      ok: false,
      message: `This season already has ${existing.length} payout row(s). Settlement is not re-runnable — clear them deliberately if they are wrong.`,
    };
  }

  const survivors = await survivorsFor(seasonId);
  const pot = await seasonPotCents(seasonId);
  const outcome = settleSeason(
    survivors.map((s) => s.entryId as EntryId),
    pot,
    weekJustCompleted,
    config,
  );

  if (outcome.kind === "no_survivors") {
    // The engine deliberately refuses to invent a rule here — everyone being
    // eliminated in the same week needs a human ruling, not a default.
    return { ok: false, message: outcome.reason };
  }

  if (outcome.kind === "in_progress") {
    return {
      ok: false,
      message: `${outcome.survivors} players are still alive and Week ${config.finalWeek} has not been completed. Nothing to settle yet.`,
    };
  }

  await db.transaction(async (tx) => {
    for (const p of outcome.payouts) {
      await tx.insert(payouts).values({
        seasonId,
        entryId: p.entryId,
        amountCents: p.amountCents,
        basis: outcome.kind === "winner" ? "winner" : "week18_even",
        settledAt: new Date(),
      });
    }

    await tx.insert(auditEvents).values({
      actorUserId,
      action: "season.settle",
      entityType: "season",
      entityId: seasonId,
      before: { potCents: pot, survivors: survivors.length },
      after: { basis: outcome.kind, payouts: outcome.payouts },
      reason: `Settled after week ${weekJustCompleted}`,
    });
  });

  return {
    ok: true,
    message:
      outcome.kind === "winner"
        ? `Settled: one winner takes the whole pot.`
        : `Settled: pot split evenly between ${outcome.payouts.length} survivors.`,
  };
}

/** The checklist itself, unpaid first because that is the working list. */
export async function listPayouts(seasonId: string): Promise<PayoutRow[]> {
  const rows = await db
    .select({
      id: payouts.id,
      entryId: payouts.entryId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      amountCents: payouts.amountCents,
      basis: payouts.basis,
      paidOutAt: payouts.paidOutAt,
      paidOutReference: payouts.paidOutReference,
    })
    .from(payouts)
    .innerJoin(entries, eq(entries.id, payouts.entryId))
    .innerJoin(users, eq(users.id, entries.userId))
    .where(eq(payouts.seasonId, seasonId))
    .orderBy(asc(payouts.paidOutAt), asc(users.lastName));

  return rows.map((r) => ({
    id: r.id,
    entryId: r.entryId,
    name: `${r.firstName} ${r.lastName}`,
    email: r.email,
    amountCents: r.amountCents,
    basis: r.basis,
    paidOutAt: r.paidOutAt,
    paidOutReference: r.paidOutReference,
  }));
}

/**
 * Tick someone off once the money has actually been sent.
 *
 * Idempotent: marking an already-paid row again keeps the ORIGINAL timestamp
 * and reference. The date a payment was made is a fact about the past, and a
 * stray second click must not rewrite it.
 */
export async function markPaidOut(
  payoutId: string,
  seasonId: string,
  actorUserId: string,
  reference: string,
): Promise<SettleResult> {
  const [row] = await db
    .select()
    .from(payouts)
    .where(and(eq(payouts.id, payoutId), eq(payouts.seasonId, seasonId)))
    .limit(1);
  if (!row) return { ok: false, message: "No such payout in this season." };

  if (row.paidOutAt) {
    return {
      ok: true,
      message: `Already marked paid on ${row.paidOutAt.toISOString().slice(0, 10)}. Left unchanged.`,
    };
  }

  await db
    .update(payouts)
    .set({
      paidOutAt: new Date(),
      paidOutByUserId: actorUserId,
      paidOutReference: reference.trim() || null,
    })
    .where(eq(payouts.id, payoutId));

  await db.insert(auditEvents).values({
    actorUserId,
    action: "payout.paid",
    entityType: "payout",
    entityId: payoutId,
    before: { paidOutAt: null },
    after: { amountCents: row.amountCents, reference: reference.trim() || null },
    reason: "Marked paid by commissioner",
  });

  return { ok: true, message: "Marked paid." };
}

/** Totals for the header: what is owed, what is settled, what is left. */
export async function payoutSummary(seasonId: string) {
  const rows = await db
    .select({ amountCents: payouts.amountCents, paidOutAt: payouts.paidOutAt })
    .from(payouts)
    .where(eq(payouts.seasonId, seasonId));

  const total = rows.reduce((n, r) => n + r.amountCents, 0);
  const paid = rows.filter((r) => r.paidOutAt).reduce((n, r) => n + r.amountCents, 0);
  return { total, paid, outstanding: total - paid, count: rows.length, paidCount: rows.filter((r) => r.paidOutAt).length };
}

/** Payouts still owed across every season, so nothing is quietly forgotten. */
export async function unpaidAcrossSeasons() {
  return db
    .select({
      seasonName: seasons.name,
      firstName: users.firstName,
      lastName: users.lastName,
      amountCents: payouts.amountCents,
    })
    .from(payouts)
    .innerJoin(seasons, eq(seasons.id, payouts.seasonId))
    .innerJoin(entries, eq(entries.id, payouts.entryId))
    .innerJoin(users, eq(users.id, entries.userId))
    .where(isNull(payouts.paidOutAt));
}
