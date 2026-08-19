/**
 * The weekly pot-split vote (D19, D19a, D19b, D19c).
 *
 * After every week the remaining survivors may agree to split. Unanimity is
 * required, silence counts as no, and the split need not be equal — any
 * allocation everyone agrees to is valid.
 *
 * Exactly one proposal is live at a time. Replacing one voids every consent
 * given to it: a yes to one allocation is never a yes to another.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, entries, payouts, splitBallots, splitProposals, users } from "@/db/schema";
import { seasonPotCents } from "@/lib/season";
import {
  evaluateSplitVote,
  splitEvenly,
  validateSplitProposal,
  type Payout,
  type SplitBallot,
  type SplitVoteOutcome,
} from "@/rules/settlement";

export interface SurvivorRow {
  entryId: string;
  userId: string;
  name: string;
}

/** Everyone still alive. Only these people vote, and only these can be paid. */
export async function survivorsFor(seasonId: string): Promise<SurvivorRow[]> {
  const rows = await db
    .select({
      entryId: entries.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(and(eq(entries.seasonId, seasonId), eq(entries.status, "active")));

  return rows.map((r) => ({
    entryId: r.entryId,
    userId: r.userId,
    name: `${r.firstName} ${r.lastName}`,
  }));
}

export interface LiveProposal {
  id: string;
  afterWeekNumber: number;
  proposedByEntryId: string;
  proposedByName: string;
  allocations: Payout[];
  potCents: number;
  note: string | null;
  openedAt: Date;
  closesAt: Date;
  ballots: Array<{ entryId: string; name: string; response: SplitBallot["response"] }>;
  outcome: SplitVoteOutcome;
}

export async function liveProposalFor(
  seasonId: string,
  now: Date = new Date(),
): Promise<LiveProposal | null> {
  const [proposal] = await db
    .select()
    .from(splitProposals)
    .where(and(eq(splitProposals.seasonId, seasonId), eq(splitProposals.status, "open")))
    .orderBy(desc(splitProposals.openedAt))
    .limit(1);

  if (!proposal) return null;

  const survivors = await survivorsFor(seasonId);
  const nameByEntry = new Map(survivors.map((s) => [s.entryId, s.name]));

  const stored = await db
    .select()
    .from(splitBallots)
    .where(eq(splitBallots.proposalId, proposal.id));
  const responseByEntry = new Map(stored.map((b) => [b.entryId, b.response]));

  // Every living survivor gets a ballot whether or not they have answered, so
  // silence is counted rather than overlooked.
  const ballots: SplitBallot[] = survivors.map((s) => ({
    entryId: s.entryId,
    response: responseByEntry.get(s.entryId) ?? "no_response",
    proposalId: proposal.id,
  }));

  const outcome = evaluateSplitVote(ballots, proposal.potCentsAtProposal, {
    openedAt: proposal.openedAt,
    closesAt: proposal.closesAt,
    now,
  }, {
    id: proposal.id,
    proposedByEntryId: proposal.proposedByEntryId,
    proposedAt: proposal.openedAt,
    allocations: proposal.allocations as Payout[],
    ...(proposal.note ? { note: proposal.note } : {}),
  });

  return {
    id: proposal.id,
    afterWeekNumber: proposal.afterWeekNumber,
    proposedByEntryId: proposal.proposedByEntryId,
    proposedByName: nameByEntry.get(proposal.proposedByEntryId) ?? "a survivor",
    allocations: proposal.allocations as Payout[],
    potCents: proposal.potCentsAtProposal,
    note: proposal.note,
    openedAt: proposal.openedAt,
    closesAt: proposal.closesAt,
    ballots: ballots.map((b) => ({
      entryId: b.entryId,
      name: nameByEntry.get(b.entryId) ?? "unknown",
      response: b.response,
    })),
    outcome,
  };
}

export type ProposalResult = { ok: true; proposalId: string } | { ok: false; message: string };

/**
 * Open a proposal, superseding any previous one.
 *
 * `allocations` may be uneven. It is validated against the living survivors and
 * the current pot before anyone can vote, so a malformed split never reaches a
 * ballot.
 */
export async function openProposal(
  seasonId: string,
  proposedByEntryId: string,
  afterWeekNumber: number,
  allocations: Payout[],
  note: string | null,
  closesAt: Date,
): Promise<ProposalResult> {
  const survivors = await survivorsFor(seasonId);
  if (survivors.length < 2) {
    return { ok: false, message: "A split needs at least two survivors." };
  }
  if (!survivors.some((s) => s.entryId === proposedByEntryId)) {
    return { ok: false, message: "Only a remaining survivor can propose a split." };
  }

  const pot = await seasonPotCents(seasonId);
  const problems = validateSplitProposal(
    {
      id: "pending",
      proposedByEntryId,
      proposedAt: new Date(),
      allocations,
      ...(note ? { note } : {}),
    },
    survivors.map((s) => s.entryId),
    pot,
  );

  if (problems.length > 0) {
    return { ok: false, message: problems.map((p) => p.message).join(" ") };
  }

  const created = await db.transaction(async (tx) => {
    // Superseding voids the old consents by construction: ballots are keyed to
    // a proposal id, so nothing carries across.
    await tx
      .update(splitProposals)
      .set({ status: "superseded", resolvedAt: new Date() })
      .where(and(eq(splitProposals.seasonId, seasonId), eq(splitProposals.status, "open")));

    const [row] = await tx
      .insert(splitProposals)
      .values({
        seasonId,
        afterWeekNumber,
        proposedByEntryId,
        allocations,
        potCentsAtProposal: pot,
        note,
        status: "open",
        closesAt,
      })
      .returning({ id: splitProposals.id });

    await tx.insert(auditEvents).values({
      action: "split.proposed",
      entityType: "season",
      entityId: seasonId,
      after: { proposalId: row?.id, allocations, potCents: pot, note },
      reason: "Survivor opened a split proposal",
    });

    return row?.id as string;
  });

  return { ok: true, proposalId: created };
}

/** Suggest an equal split, as the starting point players usually edit from. */
export async function suggestEqualSplit(seasonId: string): Promise<Payout[]> {
  const survivors = await survivorsFor(seasonId);
  const pot = await seasonPotCents(seasonId);
  return splitEvenly(pot, survivors.map((s) => s.entryId));
}

export async function castBallot(
  proposalId: string,
  entryId: string,
  response: "yes" | "no",
): Promise<{ ok: boolean; message: string }> {
  const [proposal] = await db
    .select()
    .from(splitProposals)
    .where(eq(splitProposals.id, proposalId))
    .limit(1);

  if (!proposal || proposal.status !== "open") {
    return { ok: false, message: "That proposal is no longer open." };
  }
  if (Date.now() >= proposal.closesAt.getTime()) {
    return { ok: false, message: "Voting closed when the next week began." };
  }

  const survivors = await survivorsFor(proposal.seasonId);
  if (!survivors.some((s) => s.entryId === entryId)) {
    return { ok: false, message: "Only remaining survivors can vote." };
  }

  await db
    .insert(splitBallots)
    .values({ proposalId, entryId, response, respondedAt: new Date() })
    .onConflictDoUpdate({
      target: [splitBallots.proposalId, splitBallots.entryId],
      set: { response, respondedAt: new Date() },
    });

  await db.insert(auditEvents).values({
    action: "split.vote",
    entityType: "entry",
    entityId: entryId,
    after: { proposalId, response },
  });

  return { ok: true, message: response === "yes" ? "You agreed to the split." : "You declined. Play continues." };
}

/**
 * Settle a proposal that has reached unanimity.
 *
 * Writes payout rows and marks every survivor settled. The app records what is
 * owed; the commissioner pays it personally (D22).
 */
export async function settleProposal(
  seasonId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; message: string }> {
  const live = await liveProposalFor(seasonId, now);
  if (!live) return { ok: false, message: "No open proposal." };
  if (live.outcome.status !== "accepted") {
    return { ok: false, message: `Not unanimous. ${live.outcome.reason}` };
  }

  await db.transaction(async (tx) => {
    for (const payout of live.outcome.payouts) {
      await tx.insert(payouts).values({
        seasonId,
        entryId: payout.entryId,
        amountCents: payout.amountCents,
        basis: "split",
        proposalId: live.id,
        settledAt: now,
      });
      await tx.update(entries).set({ status: "settled" }).where(eq(entries.id, payout.entryId));
    }

    await tx
      .update(splitProposals)
      .set({ status: "accepted", resolvedAt: now })
      .where(eq(splitProposals.id, live.id));

    await tx.insert(auditEvents).values({
      action: "split.settled",
      entityType: "season",
      entityId: seasonId,
      after: { proposalId: live.id, payouts: live.outcome.payouts },
      reason: live.outcome.reason,
    });
  });

  return { ok: true, message: "Split settled. Payout amounts recorded for you to pay out." };
}

/** Close a proposal whose window has passed, counting silence as no (D19a). */
export async function closeExpiredProposals(seasonId: string, now: Date = new Date()) {
  const live = await liveProposalFor(seasonId, now);
  if (!live) return { closed: false };
  if (live.outcome.status === "open") return { closed: false };
  if (live.outcome.status === "accepted") return { closed: false };

  await db
    .update(splitProposals)
    .set({ status: "rejected", resolvedAt: now })
    .where(eq(splitProposals.id, live.id));

  await db.insert(auditEvents).values({
    action: "split.rejected",
    entityType: "season",
    entityId: seasonId,
    after: { proposalId: live.id },
    reason: live.outcome.reason,
  });

  return { closed: true };
}
