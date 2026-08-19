"use server";

/**
 * Server actions.
 *
 * All validation and authorization happens here, on the server. The browser is
 * never trusted for anything that affects eligibility, money, or league state
 * (PROJECT_BRIEF: "Authorization must be enforced server-side").
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, entries, payments, users } from "@/db/schema";
import {
  MINIMUM_AGE,
  ageOn,
  attemptLogin,
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  normalizeEmail,
  validatePassword,
} from "@/lib/auth";
import { canIssueInvites, checkInvite, consumeInvite, createInvite, revokeInvite } from "@/lib/invites";
import { currentSeason } from "@/lib/season";
import { TERMS_VERSION } from "@/lib/terms";
import { tierConfig } from "@/rules/config";
import type { EntryTier } from "@/rules/types";

export interface FormState {
  error?: string;
  ok?: string;
}

// ---------------------------------------------------------------- signup

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const dateOfBirth = String(formData.get("dateOfBirth") ?? "");
  const stateOfResidence = String(formData.get("state") ?? "");
  const tier = String(formData.get("tier") ?? "") as EntryTier;
  const acceptedTerms = formData.get("terms") === "on";

  const invite = await checkInvite(token);
  if (!invite.ok) return { error: invite.message };

  if (!firstName || !lastName) {
    return { error: "First and last name are both required — the league uses real names." };
  }
  if (!email.includes("@")) return { error: "Enter a valid email address." };

  const passwordProblem = validatePassword(password);
  if (passwordProblem) return { error: passwordProblem };

  if (!dateOfBirth) return { error: "Date of birth is required." };
  const age = ageOn(dateOfBirth);
  if (Number.isNaN(age)) return { error: "Enter a valid date of birth." };
  if (age < MINIMUM_AGE) {
    return { error: `You must be at least ${MINIMUM_AGE} to take part in this pool.` };
  }
  if (age > 120) return { error: "Enter a valid date of birth." };

  if (!stateOfResidence) return { error: "Select your state of residence." };
  if (tier !== "TWENTY" && tier !== "EIGHTY") return { error: "Choose an entry option." };
  if (!acceptedTerms) return { error: "You must accept the terms to take part." };

  const season = await currentSeason();
  if (!season) return { error: "No season is configured yet. Ask the commissioner." };
  if (!season.registrationOpen) return { error: "Registration for this season is closed." };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return { error: "An account already exists for that email address. Try signing in instead." };
  }

  // Consume the invite BEFORE creating the account. If two people race for the
  // last use of a link, only one update matches (see consumeInvite) and the
  // loser gets a clean error instead of a half-created account.
  const consumed = await consumeInvite(invite.inviteId);
  if (!consumed) return { error: "That invite link was just used up." };

  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    null;

  // The very first account becomes the commissioner. After that, admin is
  // granted explicitly — otherwise anyone with the bootstrap link gets it.
  const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const isFirstUser = (userCount?.count ?? 0) === 0;

  const passwordHash = await hashPassword(password);

  const userId = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        firstName,
        lastName,
        email,
        passwordHash,
        isAdmin: isFirstUser,
        dateOfBirth,
        stateOfResidence,
        termsVersionAccepted: TERMS_VERSION,
        termsAcceptedAt: new Date(),
        termsAcceptedIp: ip,
        invitedViaInviteId: invite.inviteId,
      })
      .returning({ id: users.id });

    const newUserId = user?.id as string;

    const config = season.config;
    await tx.insert(entries).values({
      userId: newUserId,
      seasonId: season.id,
      tier,
      // Practice seasons have no payment gate (D12), so entries start active.
      status: season.mode === "practice" ? "active" : "registered",
      requiredPicks: 1,
      includedRebuysRemaining: tierConfig(config, tier).includedRebuys,
    });

    await tx.insert(auditEvents).values({
      actorUserId: newUserId,
      action: "user.signup",
      entityType: "user",
      entityId: newUserId,
      after: { email, tier, isAdmin: isFirstUser, termsVersion: TERMS_VERSION },
      reason: "Self-service signup via invite",
    });

    return newUserId;
  });

  await createSession(userId, requestHeaders.get("user-agent") ?? undefined);
  redirect("/dashboard");
}

// ---------------------------------------------------------------- login

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const requestHeaders = await headers();
  const result = await attemptLogin(email, password, requestHeaders.get("user-agent") ?? undefined);
  if (!result.ok) return { error: result.message };

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}

// ---------------------------------------------------------------- invites

export async function issueInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  if (!season.playerInvitesEnabled && !user.isAdmin) {
    return { error: "Player invites are turned off for this season." };
  }
  if (!(await canIssueInvites(user.id, season.id))) {
    return {
      error:
        "Only confirmed players can send invites. Once your entry is paid and active, you can invite others.",
    };
  }

  const note = String(formData.get("note") ?? "").trim() || undefined;
  const invite = await createInvite({
    seasonId: season.id,
    createdByUserId: user.id,
    maxUses: 1,
    ...(note ? { note } : {}),
  });

  await db.insert(auditEvents).values({
    actorUserId: user.id,
    action: "invite.create",
    entityType: "invite",
    entityId: invite.id,
    after: { maxUses: invite.maxUses, note: note ?? null },
  });

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  return { ok: invite.token };
}

export async function killInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };

  const inviteId = String(formData.get("inviteId") ?? "");
  if (!inviteId) return { error: "Missing invite." };

  await revokeInvite(inviteId);
  await db.insert(auditEvents).values({
    actorUserId: user.id,
    action: "invite.revoke",
    entityType: "invite",
    entityId: inviteId,
  });

  revalidatePath("/admin");
  return { ok: "Invite revoked." };
}

// ---------------------------------------------------------------- payments

/**
 * Mark an entry paid (D6). This is the step that puts someone in the pool.
 *
 * Recorded as a payment row plus an audit event, and flips the entry to active
 * in one transaction so an entry can never be active without the money recorded.
 */
export async function markEntryPaid(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };

  const entryId = String(formData.get("entryId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  if (!entryId) return { error: "Missing entry." };

  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const [entry] = await db.select().from(entries).where(eq(entries.id, entryId)).limit(1);
  if (!entry) return { error: "Entry not found." };
  if (entry.status === "active") return { ok: "Already active." };

  const amount = tierConfig(season.config, entry.tier).entryFeeCents;

  await db.transaction(async (tx) => {
    await tx.insert(payments).values({
      entryId,
      seasonId: season.id,
      category: "entry",
      amountCents: amount,
      status: "verified",
      externalReference: reference,
      verifiedByUserId: user.id,
      verifiedAt: new Date(),
    });

    await tx.update(entries).set({ status: "active" }).where(eq(entries.id, entryId));

    await tx.insert(auditEvents).values({
      actorUserId: user.id,
      action: "payment.verify",
      entityType: "entry",
      entityId: entryId,
      before: { status: entry.status },
      after: { status: "active", amountCents: amount, reference },
      reason: "Commissioner confirmed entry payment",
    });
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: "Marked paid." };
}

/** Undo a payment confirmation, for the inevitable misclick. Fully audited. */
export async function unmarkEntryPaid(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };

  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) return { error: "Missing entry." };

  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ status: "refunded" })
      .where(and(eq(payments.entryId, entryId), eq(payments.category, "entry")));

    await tx.update(entries).set({ status: "registered" }).where(eq(entries.id, entryId));

    await tx.insert(auditEvents).values({
      actorUserId: user.id,
      action: "payment.reverse",
      entityType: "entry",
      entityId: entryId,
      after: { status: "registered" },
      reason: "Commissioner reversed a payment confirmation",
    });
  });

  revalidatePath("/admin");
  return { ok: "Payment reversed." };
}
