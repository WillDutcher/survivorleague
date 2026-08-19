/**
 * Invite tokens (D7).
 *
 * Signup requires a valid invite. No token, no account. Any *confirmed* player
 * — paid and active — can generate a link to forward; unpaid registrants cannot,
 * because that would leak the gate.
 *
 * There is deliberately no approval queue for forwarded invites. The
 * commissioner-verified payment step (D6) already gates roster entry, so a
 * stranger holding a forwarded link still cannot reach the pool. One queue to
 * watch instead of two.
 */

import { randomBytes } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { entries, invites, users } from "@/db/schema";

const DEFAULT_EXPIRY_DAYS = 45;

export interface InviteIssue {
  token: string;
  id: string;
  expiresAt: Date | null;
  maxUses: number;
}

export async function createInvite(options: {
  seasonId: string;
  createdByUserId: string | null;
  maxUses?: number;
  expiresInDays?: number;
  note?: string;
}): Promise<InviteIssue> {
  const token = randomBytes(18).toString("base64url");
  const days = options.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(Date.now() + days * 86_400_000);

  const [row] = await db
    .insert(invites)
    .values({
      token,
      seasonId: options.seasonId,
      createdByUserId: options.createdByUserId,
      maxUses: options.maxUses ?? 1,
      expiresAt,
      note: options.note ?? null,
    })
    .returning({ id: invites.id });

  return { token, id: row?.id ?? "", expiresAt, maxUses: options.maxUses ?? 1 };
}

export type InviteCheck =
  | { ok: true; inviteId: string; seasonId: string }
  | { ok: false; message: string };

/** Validate without consuming. Used to render the signup form. */
export async function checkInvite(token: string): Promise<InviteCheck> {
  const trimmed = token.trim();
  if (!trimmed) return { ok: false, message: "An invite link is required to sign up." };

  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.token, trimmed))
    .limit(1);

  if (!invite) {
    return { ok: false, message: "That invite link is not valid." };
  }
  if (invite.revokedAt) {
    return { ok: false, message: "That invite link has been revoked by the commissioner." };
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, message: "That invite link has expired. Ask whoever sent it for a new one." };
  }
  if (invite.uses >= invite.maxUses) {
    return { ok: false, message: "That invite link has already been used." };
  }

  return { ok: true, inviteId: invite.id, seasonId: invite.seasonId };
}

/**
 * Consume one use, atomically.
 *
 * The `uses < max_uses` predicate lives in the UPDATE itself, so two people
 * submitting the same single-use link at the same moment cannot both succeed —
 * the second update matches no rows. Checking first and updating after would
 * leave a race open.
 */
export async function consumeInvite(inviteId: string): Promise<boolean> {
  const updated = await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(
      and(
        eq(invites.id, inviteId),
        isNull(invites.revokedAt),
        sql`${invites.uses} < ${invites.maxUses}`,
      ),
    )
    .returning({ id: invites.id });

  return updated.length > 0;
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, inviteId));
}

/** Whether this user may generate invites: confirmed players and admins only. */
export async function canIssueInvites(userId: string, seasonId: string): Promise<boolean> {
  const [row] = await db
    .select({ isAdmin: users.isAdmin, status: entries.status })
    .from(users)
    .leftJoin(entries, and(eq(entries.userId, users.id), eq(entries.seasonId, seasonId)))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return false;
  if (row.isAdmin) return true;
  return row.status === "active";
}

export interface InviteRow {
  id: string;
  token: string;
  createdAt: Date;
  expiresAt: Date | null;
  maxUses: number;
  uses: number;
  revokedAt: Date | null;
  note: string | null;
  createdByName: string | null;
  claimedByName: string | null;
}

/**
 * All invites for a season, with who issued each and who claimed it.
 *
 * Unclaimed invites are the "invited but never signed up" list — the 2019
 * workbook kept that as a second column of names (D14); here it falls out of
 * the data for free.
 */
export async function listInvites(seasonId: string): Promise<InviteRow[]> {
  const issuer = db.$with("x").as(db.select().from(users));
  void issuer;

  const rows = await db
    .select({
      id: invites.id,
      token: invites.token,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      maxUses: invites.maxUses,
      uses: invites.uses,
      revokedAt: invites.revokedAt,
      note: invites.note,
      createdByFirst: users.firstName,
      createdByLast: users.lastName,
    })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.createdByUserId))
    .where(eq(invites.seasonId, seasonId))
    .orderBy(invites.createdAt);

  const claimants = await db
    .select({
      inviteId: users.invitedViaInviteId,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users);

  const claimedBy = new Map<string, string>();
  for (const c of claimants) {
    if (c.inviteId) claimedBy.set(c.inviteId, `${c.firstName} ${c.lastName}`);
  }

  return rows.map((r) => ({
    id: r.id,
    token: r.token,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    maxUses: r.maxUses,
    uses: r.uses,
    revokedAt: r.revokedAt,
    note: r.note,
    createdByName: r.createdByFirst ? `${r.createdByFirst} ${r.createdByLast}` : null,
    claimedByName: claimedBy.get(r.id) ?? null,
  }));
}

export function inviteUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/join/${token}`;
}

/** Unused for now but kept adjacent: `or` import guards future filters. */
void or;
