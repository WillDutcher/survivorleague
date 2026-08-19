/**
 * Pot accounting, the weekly split vote, and final settlement (D19, D19a, D6).
 *
 * Two invariants govern everything here:
 *
 *   1. THE MONEY MUST BALANCE EXACTLY. Payouts always sum to the pot, to the
 *      cent. The commissioner takes no rake, and that has to be arithmetically
 *      true, not just intended — a rounding remainder that quietly vanishes is
 *      indistinguishable from a rake (D7, D21).
 *
 *   2. UNANIMITY IS NEVER INFERRED. A split requires every remaining survivor to
 *      say yes out loud. Silence counts as no (D19a), so nobody's share can be
 *      given away by missing an email.
 *
 * A split need not be equal (D19b). Survivors may negotiate any allocation --
 * historically, players wanting out have bought off a player who wanted to keep
 * going. Any allocation is legal provided it covers exactly the remaining
 * survivors and sums exactly to the pot, and provided everyone consents.
 *
 * Consents are bound to a specific proposal. Editing the numbers voids every
 * prior consent, because a yes to one allocation is not a yes to another.
 */

import type { SeasonConfig } from "./config";
import type { EntryId } from "./types";

// ---------------------------------------------------------------- pot

export type PaymentCategory = "entry" | "rebuy";
export type PaymentStatus = "pending" | "verified" | "refunded";

export interface PaymentRecord {
  entryId: EntryId;
  category: PaymentCategory;
  amountCents: number;
  status: PaymentStatus;
}

/**
 * The pot is the sum of VERIFIED payments only (D6). Pending payments are money
 * the commissioner has not yet confirmed arriving, and counting them would
 * inflate the pot and overpay the winner.
 *
 * Included $80 rebuys contribute nothing — they were paid for at entry.
 * Practice seasons have no pot (D12).
 */
export function potCents(payments: readonly PaymentRecord[], config: SeasonConfig): number {
  if (config.mode === "practice") return 0;
  return payments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + p.amountCents, 0);
}

// ---------------------------------------------------------------- payouts

export interface Payout {
  entryId: EntryId;
  amountCents: number;
}

/**
 * Divide a pot evenly, distributing any indivisible remainder deterministically.
 *
 * $2,000 among 3 people is $666.66 each with 2 cents left over. Those cents go
 * to the first recipients in sorted entry order — arbitrary but fixed, so the
 * same inputs always produce the same payouts and the total always reconciles.
 */
export function splitEvenly(potCents: number, entryIds: readonly EntryId[]): Payout[] {
  if (entryIds.length === 0) return [];
  if (potCents < 0) throw new Error("Pot cannot be negative.");

  const ordered = [...entryIds].sort();
  const base = Math.floor(potCents / ordered.length);
  const remainder = potCents % ordered.length;

  const payouts = ordered.map((entryId, index) => ({
    entryId,
    amountCents: base + (index < remainder ? 1 : 0),
  }));

  assertBalances(payouts, potCents);
  return payouts;
}

/** Guard against any future change that would silently lose or invent money. */
function assertBalances(payouts: readonly Payout[], expected: number): void {
  const total = payouts.reduce((sum, p) => sum + p.amountCents, 0);
  if (total !== expected) {
    throw new Error(
      `Settlement does not balance: payouts total ${total} but the pot is ${expected}.`,
    );
  }
}

// ---------------------------------------------------------------- split vote

export type SplitVoteResponse = "yes" | "no" | "no_response";

export interface SplitBallot {
  entryId: EntryId;
  response: SplitVoteResponse;
  /**
   * The proposal this consent was given to. A ballot referencing any other
   * proposal is stale and counts as no response — a yes to one allocation is
   * never a yes to a different one (D19b).
   */
  proposalId?: string;
}

/**
 * A proposed division of the pot. Need not be equal: survivors may negotiate
 * any allocation, such as paying off a player who would rather keep playing.
 */
export interface SplitProposal {
  id: string;
  proposedByEntryId: EntryId;
  proposedAt: Date;
  allocations: readonly Payout[];
  /** Free text from the proposer, e.g. "Dave gets +$20 each from us to stop." */
  note?: string;
}

export type SplitVoteStatus = "open" | "accepted" | "rejected" | "invalid_proposal";

export interface ProposalProblem {
  code:
    | "does_not_balance"
    | "missing_survivor"
    | "unknown_recipient"
    | "duplicate_recipient"
    | "negative_amount";
  message: string;
}

/**
 * A proposal is legal only if it covers exactly the remaining survivors, once
 * each, with no negative amounts, summing exactly to the pot.
 *
 * Validated at proposal time so a malformed allocation can never reach a vote,
 * and re-validated at settlement as defense in depth.
 */
export function validateSplitProposal(
  proposal: SplitProposal,
  survivorEntryIds: readonly EntryId[],
  potCents: number,
): ProposalProblem[] {
  const problems: ProposalProblem[] = [];
  const survivors = new Set(survivorEntryIds);
  const seen = new Set<EntryId>();

  for (const allocation of proposal.allocations) {
    if (allocation.amountCents < 0) {
      problems.push({
        code: "negative_amount",
        message: `${allocation.entryId} is allocated a negative amount.`,
      });
    }
    if (!survivors.has(allocation.entryId)) {
      problems.push({
        code: "unknown_recipient",
        message: `${allocation.entryId} is not a remaining survivor and cannot receive a share.`,
      });
    }
    if (seen.has(allocation.entryId)) {
      problems.push({
        code: "duplicate_recipient",
        message: `${allocation.entryId} appears more than once in the proposal.`,
      });
    }
    seen.add(allocation.entryId);
  }

  for (const survivor of survivorEntryIds) {
    if (!seen.has(survivor)) {
      problems.push({
        code: "missing_survivor",
        message: `${survivor} is still alive but receives nothing in this proposal. Every survivor must appear, even at $0.`,
      });
    }
  }

  const total = proposal.allocations.reduce((sum, a) => sum + a.amountCents, 0);
  if (total !== potCents) {
    problems.push({
      code: "does_not_balance",
      message: `Proposal allocates ${total} cents but the pot is ${potCents} cents.`,
    });
  }

  return problems;
}

/** Build the ordinary equal-split proposal, used as the default suggestion. */
export function equalSplitProposal(
  id: string,
  proposedByEntryId: EntryId,
  proposedAt: Date,
  survivorEntryIds: readonly EntryId[],
  potCents: number,
): SplitProposal {
  return {
    id,
    proposedByEntryId,
    proposedAt,
    allocations: splitEvenly(potCents, survivorEntryIds),
    note: "Equal split.",
  };
}

export interface SplitVoteOutcome {
  status: SplitVoteStatus;
  unanimous: boolean;
  yes: number;
  no: number;
  awaiting: number;
  reason: string;
  payouts: Payout[];
}

export interface SplitVoteWindow {
  openedAt: Date;
  /** Kickoff of the first game of the next week — the next week has begun (D19a). */
  closesAt: Date;
  now: Date;
}

/**
 * Evaluate a weekly split vote among the remaining survivors.
 *
 * A single "no" ends it immediately — there is no reason to keep the vote open
 * once unanimity is impossible; the option is removed and play continues.
 * Otherwise the vote stays open until every survivor says yes, or until the
 * window closes and the silent are counted as no.
 */
export function evaluateSplitVote(
  ballots: readonly SplitBallot[],
  potCents: number,
  window: SplitVoteWindow,
  proposal?: SplitProposal,
): SplitVoteOutcome {
  // A consent given to a superseded proposal is not a consent to this one.
  const live = ballots.map((b) =>
    proposal && b.proposalId !== undefined && b.proposalId !== proposal.id
      ? { ...b, response: "no_response" as SplitVoteResponse }
      : b,
  );

  const yes = live.filter((b) => b.response === "yes").length;
  const no = live.filter((b) => b.response === "no").length;
  const awaiting = live.filter((b) => b.response === "no_response").length;

  const base = { yes, no, awaiting, payouts: [] as Payout[] };

  if (proposal) {
    const problems = validateSplitProposal(
      proposal,
      ballots.map((b) => b.entryId),
      potCents,
    );
    if (problems.length > 0) {
      return {
        ...base,
        status: "invalid_proposal",
        unanimous: false,
        reason: `This proposal cannot be settled: ${problems.map((p) => p.message).join(" ")}`,
      };
    }
  }

  if (live.length === 0) {
    return { ...base, status: "rejected", unanimous: false, reason: "No survivors to poll." };
  }

  // One survivor left is not a split — they have won outright.
  if (live.length === 1) {
    return {
      ...base,
      status: "rejected",
      unanimous: false,
      reason: "Only one survivor remains; this is an outright win, not a split.",
    };
  }

  if (no > 0) {
    return {
      ...base,
      status: "rejected",
      unanimous: false,
      reason:
        `${no} survivor(s) declined. A split requires unanimous consent, so the option ` +
        `is removed and play continues to the next week.`,
    };
  }

  if (yes === live.length) {
    const payouts = proposal
      ? [...proposal.allocations]
      : splitEvenly(potCents, live.map((b) => b.entryId));
    assertBalances(payouts, potCents);
    return {
      ...base,
      status: "accepted",
      unanimous: true,
      reason:
        `All ${yes} remaining survivors agreed to the proposed split. The season ends here.` +
        (proposal?.note ? ` Terms: ${proposal.note}` : ""),
      payouts,
    };
  }

  if (window.now.getTime() >= window.closesAt.getTime()) {
    return {
      ...base,
      status: "rejected",
      unanimous: false,
      reason:
        `The vote closed at the first kickoff of the next week with ${awaiting} survivor(s) ` +
        `not responding. A non-response counts as no, so play continues.`,
    };
  }

  return {
    ...base,
    status: "open",
    unanimous: false,
    reason: `Waiting on ${awaiting} of ${live.length} survivors. Silence will count as no at close.`,
  };
}

/** When non-voters should be reminded (D19a). */
export function splitVoteReminderAt(openedAt: Date, hours = 48): Date {
  return new Date(openedAt.getTime() + hours * 3600_000);
}

// ---------------------------------------------------------------- final settlement

export type SeasonOutcome =
  | { kind: "in_progress"; survivors: number }
  | { kind: "winner"; payouts: Payout[] }
  | { kind: "split"; payouts: Payout[]; reason: string }
  | { kind: "no_survivors"; reason: string };

/**
 * Settle a season once the final week has been processed, or as soon as only one
 * survivor remains.
 *
 * Multiple survivors after the final week split evenly (PROJECT_BRIEF).
 */
export function settleSeason(
  survivorEntryIds: readonly EntryId[],
  potCents: number,
  weekJustCompleted: number,
  config: SeasonConfig,
): SeasonOutcome {
  const seasonOver = weekJustCompleted >= config.finalWeek;

  if (survivorEntryIds.length === 1) {
    const winner = survivorEntryIds[0] as EntryId;
    return { kind: "winner", payouts: [{ entryId: winner, amountCents: potCents }] };
  }

  if (survivorEntryIds.length === 0) {
    return {
      kind: "no_survivors",
      reason:
        `No survivors remain after Week ${weekJustCompleted}. ` +
        `Commissioner ruling required on disposition of the pot.`,
    };
  }

  if (seasonOver) {
    return {
      kind: "split",
      payouts: splitEvenly(potCents, survivorEntryIds),
      reason:
        `${survivorEntryIds.length} survivors remained after Week ${config.finalWeek}. ` +
        `The pot splits evenly among them.`,
    };
  }

  return { kind: "in_progress", survivors: survivorEntryIds.length };
}
