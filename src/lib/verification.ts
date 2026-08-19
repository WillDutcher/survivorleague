/**
 * Email verification.
 *
 * Deliberately NOT a gate on playing. The pool is invite-only and the
 * commissioner confirms payment by hand, so an unverified address is not a
 * security hole — it is a DELIVERABILITY problem. Every reminder, every payment
 * nag, and every rebuy offer goes to this address, so a typo means someone
 * silently never hears from the league.
 *
 * So: verification is nagged, surfaced to the commissioner, and never blocks a
 * pick. Locking someone out of their picks over an unconfirmed email would cause
 * exactly the harm it is meant to prevent.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { emailVerifications, users } from "@/db/schema";
import { sendEmail } from "@/lib/mail";

const TTL_HOURS = 72;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueVerification(userId: string): Promise<string> {
  // Any earlier outstanding token stops working the moment a new one is issued.
  await db
    .update(emailVerifications)
    .set({ usedAt: new Date() })
    .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.usedAt)));

  const token = randomBytes(32).toString("base64url");
  await db.insert(emailVerifications).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
  });

  return token;
}

export async function sendVerificationEmail(
  userId: string,
  origin: string,
): Promise<{ sent: boolean; error?: string }> {
  const [user] = await db
    .select({ email: users.email, firstName: users.firstName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { sent: false, error: "User not found." };

  const token = await issueVerification(userId);
  const link = `${origin.replace(/\/$/, "")}/verify/${token}`;

  const result = await sendEmail({
    to: user.email,
    type: "email_verification",
    subject: "Confirm your email for Survivor League",
    html: `
      <p>${user.firstName},</p>
      <p>Confirm this address so the league can reach you with weekly reminders and deadlines.</p>
      <p><a href="${link}">Confirm my email</a></p>
      <p>This link expires in ${TTL_HOURS} hours.</p>
      <p style="color:#666;font-size:12px">${link}</p>
    `,
  });

  return result.delivered ? { sent: true } : { sent: false, ...(result.error ? { error: result.error } : {}) };
}

export type VerifyResult = { ok: true; userId: string } | { ok: false; message: string };

export async function consumeVerification(token: string): Promise<VerifyResult> {
  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(and(eq(emailVerifications.tokenHash, hashToken(token)), isNull(emailVerifications.usedAt)))
    .limit(1);

  const bad = "That confirmation link is invalid, already used, or expired.";
  if (!row) return { ok: false, message: bad };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, message: bad };

  await db.transaction(async (tx) => {
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
    await tx
      .update(emailVerifications)
      .set({ usedAt: new Date() })
      .where(eq(emailVerifications.id, row.id));
  });

  return { ok: true, userId: row.userId };
}

export async function isVerified(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(row?.verifiedAt);
}

/** Players the commissioner cannot reliably reach. */
export async function unverifiedUsers() {
  return db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(users)
    .where(isNull(users.emailVerifiedAt));
}
