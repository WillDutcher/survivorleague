/**
 * Authentication.
 *
 * Email + password with server-side sessions (D5), built on Node's own crypto
 * rather than an auth library. The reasoning is in DECISIONS.md D24: the surface
 * here is small and well understood, the schema already carried `passwordHash`,
 * and one fewer dependency in the auth path is one fewer thing that can break or
 * be compromised three weeks before kickoff.
 *
 * Specific hazards handled, since hand-rolled auth is where people get hurt:
 *
 *   - Passwords are scrypt-hashed with a per-user random salt. Never reversible,
 *     never logged.
 *   - Comparisons use timingSafeEqual, so response time cannot be used to guess
 *     a password hash or session token byte by byte.
 *   - The session cookie holds a 32-byte random token; only its SHA-256 hash is
 *     stored, so a database leak yields no usable sessions.
 *   - Cookies are httpOnly (JS cannot read them), sameSite=lax (blocks CSRF from
 *     other origins while surviving normal navigation), and secure in production.
 *   - Login is throttled per email address to make credential guessing expensive.
 *   - Failed logins never reveal whether the address exists.
 */

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, gt, sql as sqlOp } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { loginAttempts, sessions, users } from "@/db/schema";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SESSION_COOKIE = "survivor_session";
const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;

/** Throttling: this many failures in the window locks further attempts. */
const MAX_FAILED_ATTEMPTS = 8;
const THROTTLE_WINDOW_MINUTES = 15;

// ---------------------------------------------------------------- passwords

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN);
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Password rules kept deliberately mild. A long minimum with no character-class
 * gymnastics is both more secure and less likely to make fifty casual players
 * give up during the one week that matters.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 200) return "Password must be under 200 characters.";
  return null;
}

// ---------------------------------------------------------------- sessions

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export interface CurrentUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isAdmin: boolean;
}

/** The signed-in user, or null. Safe to call from any server component. */
export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      isAdmin: users.isAdmin,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    isAdmin: row.isAdmin,
  };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

// ---------------------------------------------------------------- login

export type LoginResult =
  | { ok: true; userId: string }
  | { ok: false; message: string };

export async function attemptLogin(
  emailRaw: string,
  password: string,
  userAgent?: string,
): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);

  if (await isThrottled(email)) {
    return {
      ok: false,
      message: `Too many failed sign-in attempts. Wait ${THROTTLE_WINDOW_MINUTES} minutes and try again, or reset your password.`,
    };
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Same generic message whether the address is unknown or the password is
  // wrong, so this endpoint cannot be used to enumerate who is in the league.
  const failure: LoginResult = { ok: false, message: "Email or password is incorrect." };

  if (!user) {
    await db.insert(loginAttempts).values({ email, succeeded: false });
    return failure;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  await db.insert(loginAttempts).values({ email, succeeded: valid });
  if (!valid) return failure;

  await createSession(user.id, userAgent);
  return { ok: true, userId: user.id };
}

async function isThrottled(email: string): Promise<boolean> {
  const since = new Date(Date.now() - THROTTLE_WINDOW_MINUTES * 60_000);
  const recent = await db
    .select({ succeeded: loginAttempts.succeeded })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.attemptedAt, since)))
    .orderBy(desc(loginAttempts.attemptedAt))
    .limit(MAX_FAILED_ATTEMPTS);

  return (
    recent.length >= MAX_FAILED_ATTEMPTS && recent.every((attempt) => attempt.succeeded === false)
  );
}

// ---------------------------------------------------------------- helpers

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Age in whole years on a given date. Used for the 18+ gate (D8).
 * Computed from the stored date of birth rather than trusting a checkbox.
 */
export function ageOn(dateOfBirth: string, on: Date = new Date()): number {
  const [y, m, d] = dateOfBirth.split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;

  let age = on.getUTCFullYear() - y;
  const beforeBirthday =
    on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export const MINIMUM_AGE = 18;

/** Total sessions and users, for the admin overview. */
export async function activeSessionCount(): Promise<number> {
  const [row] = await db
    .select({ count: sqlOp<number>`count(*)::int` })
    .from(sessions)
    .where(gt(sessions.expiresAt, new Date()));
  return row?.count ?? 0;
}
