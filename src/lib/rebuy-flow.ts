/**
 * Rebuy acceptance.
 *
 * A loss creates a rebuy OFFER (see processing.ts). Nothing is granted silently:
 * the player must accept it, and a purchased rebuy stays inactive until the
 * commissioner confirms the money arrived (D6).
 *
 *   included ($80)  accept -> active immediately, one rebuy consumed
 *   paid ($20)      accept -> awaiting payment -> commissioner confirms -> active
 *
 * Re-entry never restores used teams, and it clears any outstanding tie debt
 * (D17b).
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, entries, payments, rebuys } from "@/db/schema";
import { requiredPicksAfterRebuy } from "@/rules/rebuys";
import type { SeasonConfig } from "@/rules/config";

export interface OpenRebuy {
  id: string;
  entryId: string;
  lossWeekNumber: number;
  kind: "included" | "paid";
  priceCents: number;
  status: string;
}

/** The outstanding rebuy for an entry, if any. */
export async function openRebuyFor(entryId: string): Promise<OpenRebuy | null> {
  const [row] = await db
    .select()
    .from(rebuys)
    .where(eq(rebuys.entryId, entryId))
    .orderBy(desc(rebuys.createdAt))
    .limit(1);

  if (!row) return null;
  if (row.status === "processed" || row.status === "declined" || row.status === "expired") {
    return null;
  }
  return {
    id: row.id,
    entryId: row.entryId,
    lossWeekNumber: row.lossWeekNumber,
    kind: row.kind,
    priceCents: row.priceCents,
    status: row.status,
  };
}

export type RebuyResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Accept an offered rebuy.
 *
 * An included rebuy reactivates immediately and decrements the allowance. A
 * purchased one only moves to `awaiting_payment` — the entry does not become
 * active until the commissioner confirms, exactly as with an initial entry.
 */
export async function acceptRebuy(
  rebuyId: string,
  entryId: string,
  seasonId: string,
  config: SeasonConfig,
): Promise<RebuyResult> {
  const [rebuy] = await db.select().from(rebuys).where(eq(rebuys.id, rebuyId)).limit(1);
  if (!rebuy || rebuy.entryId !== entryId) return { ok: false, message: "Rebuy not found." };
  if (rebuy.status === "processed") return { ok: false, message: "That rebuy is already processed." };

  const [entry] = await db.select().from(entries).where(eq(entries.id, entryId)).limit(1);
  if (!entry) return { ok: false, message: "Entry not found." };

  if (rebuy.kind === "included") {
    if (entry.includedRebuysRemaining <= 0) {
      return { ok: false, message: "You have no included rebuys left." };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(entries)
        .set({
          status: "active",
          includedRebuysRemaining: entry.includedRebuysRemaining - 1,
          requiredPicks: requiredPicksAfterRebuy(config, entry.requiredPicks),
        })
        .where(eq(entries.id, entryId));

      await tx
        .update(rebuys)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(rebuys.id, rebuyId));

      // Recorded at zero so the ledger shows the rebuy happened without
      // inflating the pot — it was paid for at entry.
      await tx.insert(payments).values({
        entryId,
        seasonId,
        category: "rebuy",
        amountCents: 0,
        status: "verified",
        externalReference: "Included with $80 entry",
        verifiedAt: new Date(),
      });

      await tx.insert(auditEvents).values({
        action: "rebuy.accepted_included",
        entityType: "entry",
        entityId: entryId,
        after: { lossWeek: rebuy.lossWeekNumber, remaining: entry.includedRebuysRemaining - 1 },
        reason: "Player used an included rebuy",
      });
    });

    return {
      ok: true,
      message: `You are back in. ${entry.includedRebuysRemaining - 1} included rebuy(s) left.`,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(rebuys)
      .set({ status: "awaiting_payment" })
      .where(eq(rebuys.id, rebuyId));

    await tx.insert(auditEvents).values({
      action: "rebuy.accepted_paid",
      entityType: "entry",
      entityId: entryId,
      after: { lossWeek: rebuy.lossWeekNumber, priceCents: rebuy.priceCents },
      reason: "Player chose to buy back in; awaiting payment",
    });
  });

  return {
    ok: true,
    message: "Send the payment and the commissioner will confirm it. You are not back in until then.",
  };
}

export async function declineRebuy(rebuyId: string, entryId: string): Promise<RebuyResult> {
  const [rebuy] = await db.select().from(rebuys).where(eq(rebuys.id, rebuyId)).limit(1);
  if (!rebuy || rebuy.entryId !== entryId) return { ok: false, message: "Rebuy not found." };
  if (rebuy.status === "processed") return { ok: false, message: "That rebuy is already processed." };

  await db.transaction(async (tx) => {
    await tx.update(rebuys).set({ status: "declined" }).where(eq(rebuys.id, rebuyId));
    await tx
      .update(entries)
      .set({ status: "eliminated", eliminatedAtWeek: rebuy.lossWeekNumber })
      .where(eq(entries.id, entryId));
    await tx.insert(auditEvents).values({
      action: "rebuy.declined",
      entityType: "entry",
      entityId: entryId,
      reason: "Player declined the rebuy",
    });
  });

  return { ok: true, message: "Rebuy declined. Your season is over." };
}

/** Commissioner confirms a purchased rebuy, which is what reactivates the entry. */
export async function confirmRebuyPayment(
  rebuyId: string,
  adminUserId: string,
  seasonId: string,
  config: SeasonConfig,
  reference: string | null,
): Promise<RebuyResult> {
  const [rebuy] = await db.select().from(rebuys).where(eq(rebuys.id, rebuyId)).limit(1);
  if (!rebuy) return { ok: false, message: "Rebuy not found." };
  if (rebuy.status === "processed") return { ok: true, message: "Already processed." };

  const [entry] = await db.select().from(entries).where(eq(entries.id, rebuy.entryId)).limit(1);
  if (!entry) return { ok: false, message: "Entry not found." };

  await db.transaction(async (tx) => {
    await tx.insert(payments).values({
      entryId: rebuy.entryId,
      seasonId,
      category: "rebuy",
      amountCents: rebuy.priceCents,
      status: "verified",
      externalReference: reference,
      verifiedByUserId: adminUserId,
      verifiedAt: new Date(),
    });

    await tx
      .update(rebuys)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(rebuys.id, rebuyId));

    await tx
      .update(entries)
      .set({ status: "active", requiredPicks: requiredPicksAfterRebuy(config, entry.requiredPicks) })
      .where(eq(entries.id, rebuy.entryId));

    await tx.insert(auditEvents).values({
      actorUserId: adminUserId,
      action: "rebuy.payment_confirmed",
      entityType: "entry",
      entityId: rebuy.entryId,
      after: { amountCents: rebuy.priceCents, lossWeek: rebuy.lossWeekNumber, reference },
      reason: "Commissioner confirmed a rebuy payment",
    });
  });

  return { ok: true, message: "Rebuy confirmed. They are back in and the pot has grown." };
}

/** Rebuys the commissioner still needs to confirm payment for. */
export async function rebuysAwaitingPayment(seasonId: string) {
  return db
    .select({
      rebuyId: rebuys.id,
      entryId: rebuys.entryId,
      lossWeekNumber: rebuys.lossWeekNumber,
      priceCents: rebuys.priceCents,
    })
    .from(rebuys)
    .innerJoin(entries, eq(entries.id, rebuys.entryId))
    .where(and(eq(entries.seasonId, seasonId), eq(rebuys.status, "awaiting_payment")));
}
