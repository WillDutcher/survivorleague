/**
 * Admin exceptions — data problems a human has to look at.
 *
 * These exist because the sync deliberately refuses to guess. A game it cannot
 * match to a team, a line it cannot find, a score that contradicts one already
 * recorded: all of it is written down rather than silently resolved, because a
 * wrong guess about league data becomes a wrong elimination.
 *
 * DEDUPLICATION IS THE POINT. Syncs run on a schedule, and an unmatched game
 * stays unmatched every time until someone fixes it. Inserting a fresh row per
 * run buries the one new problem under fifty copies of the old one, and makes
 * resolving anything pointless. So an open exception with the same season, kind
 * and message is left alone and its `lastSeenAt` bumped instead.
 *
 * A problem that recurs AFTER being resolved does raise a new row. That is
 * genuinely new information: it means the fix did not hold.
 */

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { adminExceptions, auditEvents, users } from "@/db/schema";

export interface ExceptionRow {
  id: string;
  kind: string;
  severity: string;
  message: string;
  context: unknown;
  seenCount: number;
  createdAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface RaiseInput {
  seasonId: string | null;
  kind: string;
  message: string;
  severity?: string;
  context?: Record<string, unknown>;
}

/**
 * Record a problem, or note that an already-open one is still happening.
 *
 * Returns whether a new row was created, which callers can use to decide
 * whether anything is worth telling the commissioner about.
 */
export async function raiseException(input: RaiseInput): Promise<{ created: boolean; id: string }> {
  const existing = await db
    .select({ id: adminExceptions.id, context: adminExceptions.context })
    .from(adminExceptions)
    .where(
      and(
        input.seasonId
          ? eq(adminExceptions.seasonId, input.seasonId)
          : isNull(adminExceptions.seasonId),
        eq(adminExceptions.kind, input.kind),
        eq(adminExceptions.message, input.message),
        isNull(adminExceptions.resolvedAt),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const prior = (existing[0].context ?? {}) as Record<string, unknown>;
    const seen = typeof prior.seenCount === "number" ? prior.seenCount : 1;
    await db
      .update(adminExceptions)
      .set({
        context: { ...prior, ...(input.context ?? {}), seenCount: seen + 1, lastSeenAt: new Date().toISOString() },
      })
      .where(eq(adminExceptions.id, existing[0].id));
    return { created: false, id: existing[0].id };
  }

  const [row] = await db
    .insert(adminExceptions)
    .values({
      seasonId: input.seasonId,
      kind: input.kind,
      severity: input.severity ?? "warning",
      message: input.message,
      context: { ...(input.context ?? {}), seenCount: 1, lastSeenAt: new Date().toISOString() },
    })
    .returning({ id: adminExceptions.id });

  return { created: true, id: row!.id };
}

function toRow(r: {
  id: string;
  kind: string;
  severity: string;
  message: string;
  context: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  resolverFirst: string | null;
  resolverLast: string | null;
}): ExceptionRow {
  const ctx = (r.context ?? {}) as Record<string, unknown>;
  const lastSeen = typeof ctx.lastSeenAt === "string" ? new Date(ctx.lastSeenAt) : r.createdAt;
  return {
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    message: r.message,
    context: r.context,
    seenCount: typeof ctx.seenCount === "number" ? ctx.seenCount : 1,
    createdAt: r.createdAt,
    lastSeenAt: Number.isNaN(lastSeen.getTime()) ? r.createdAt : lastSeen,
    resolvedAt: r.resolvedAt,
    resolvedBy:
      r.resolverFirst && r.resolverLast ? `${r.resolverFirst} ${r.resolverLast}` : null,
    resolutionNote: r.resolutionNote,
  };
}

const SELECTION = {
  id: adminExceptions.id,
  kind: adminExceptions.kind,
  severity: adminExceptions.severity,
  message: adminExceptions.message,
  context: adminExceptions.context,
  createdAt: adminExceptions.createdAt,
  resolvedAt: adminExceptions.resolvedAt,
  resolutionNote: adminExceptions.resolutionNote,
  resolverFirst: users.firstName,
  resolverLast: users.lastName,
};

/** Everything still open, worst first. */
export async function openExceptions(seasonId?: string): Promise<ExceptionRow[]> {
  const rows = await db
    .select(SELECTION)
    .from(adminExceptions)
    .leftJoin(users, eq(users.id, adminExceptions.resolvedByUserId))
    .where(
      seasonId
        ? and(isNull(adminExceptions.resolvedAt), eq(adminExceptions.seasonId, seasonId))
        : isNull(adminExceptions.resolvedAt),
    )
    .orderBy(desc(adminExceptions.createdAt));

  // "error" above "warning" above anything else, then newest first.
  const rank = (s: string) => (s === "error" ? 0 : s === "warning" ? 1 : 2);
  return rows.map(toRow).sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** Recently resolved, so a fix that did not hold is visible. */
export async function resolvedExceptions(limit = 10): Promise<ExceptionRow[]> {
  const rows = await db
    .select(SELECTION)
    .from(adminExceptions)
    .leftJoin(users, eq(users.id, adminExceptions.resolvedByUserId))
    .where(isNotNull(adminExceptions.resolvedAt))
    .orderBy(desc(adminExceptions.resolvedAt))
    .limit(limit);
  return rows.map(toRow);
}

/**
 * Mark one resolved.
 *
 * Resolving is a claim that a human looked and dealt with it, so it is audited
 * and the note is kept. Re-resolving an already-resolved row changes nothing —
 * the first resolution is the true one.
 */
export async function resolveException(
  exceptionId: string,
  actorUserId: string,
  note: string,
): Promise<{ ok: boolean; message: string }> {
  const [row] = await db
    .select()
    .from(adminExceptions)
    .where(eq(adminExceptions.id, exceptionId))
    .limit(1);
  if (!row) return { ok: false, message: "No such exception." };
  if (row.resolvedAt) return { ok: true, message: "Already resolved. Left unchanged." };

  await db
    .update(adminExceptions)
    .set({
      resolvedAt: new Date(),
      resolvedByUserId: actorUserId,
      resolutionNote: note.trim() || null,
    })
    .where(eq(adminExceptions.id, exceptionId));

  await db.insert(auditEvents).values({
    actorUserId,
    action: "exception.resolve",
    entityType: "admin_exception",
    entityId: exceptionId,
    before: { kind: row.kind, message: row.message },
    after: { resolved: true },
    reason: note.trim() || "Resolved by commissioner",
  });

  return { ok: true, message: "Marked resolved." };
}

/**
 * Resolve every open exception of one kind at once.
 *
 * The realistic case is a sync that raised thirty rows for one underlying
 * cause, all fixed by a single re-sync. Ticking them off individually is busy
 * work that discourages using the screen at all.
 */
export async function resolveAllOfKind(
  kind: string,
  actorUserId: string,
  note: string,
  seasonId?: string,
): Promise<{ ok: boolean; message: string }> {
  const open = await db
    .select({ id: adminExceptions.id })
    .from(adminExceptions)
    .where(
      and(
        isNull(adminExceptions.resolvedAt),
        eq(adminExceptions.kind, kind),
        ...(seasonId ? [eq(adminExceptions.seasonId, seasonId)] : []),
      ),
    );

  if (open.length === 0) return { ok: false, message: `Nothing open of kind "${kind}".` };

  await db
    .update(adminExceptions)
    .set({
      resolvedAt: new Date(),
      resolvedByUserId: actorUserId,
      resolutionNote: note.trim() || `Bulk resolved (${kind})`,
    })
    .where(
      and(
        isNull(adminExceptions.resolvedAt),
        eq(adminExceptions.kind, kind),
        ...(seasonId ? [eq(adminExceptions.seasonId, seasonId)] : []),
      ),
    );

  await db.insert(auditEvents).values({
    actorUserId,
    action: "exception.resolve_bulk",
    entityType: "admin_exception",
    entityId: kind,
    before: { kind, openCount: open.length },
    after: { resolved: open.length },
    reason: note.trim() || `Bulk resolved (${kind})`,
  });

  return { ok: true, message: `Resolved ${open.length} ${kind} exception(s).` };
}

/** How many are open, for the header badge. */
export async function openExceptionCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminExceptions)
    .where(isNull(adminExceptions.resolvedAt));
  return row?.n ?? 0;
}
