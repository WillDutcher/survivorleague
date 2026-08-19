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
import { auditEvents, entries, payments, seasons, users } from "@/db/schema";
import {
  MINIMUM_AGE,
  ageOn,
  attemptLogin,
  changePassword as changePasswordFor,
  consumePasswordReset,
  createPasswordReset,
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

  // Deliverability, not a gate (see lib/verification.ts). A failure here must
  // never undo a completed signup.
  try {
    const origin =
      requestHeaders.get("origin") ?? `http://${requestHeaders.get("host") ?? "localhost:3000"}`;
    const { sendVerificationEmail } = await import("@/lib/verification");
    await sendVerificationEmail(userId, origin);
  } catch {
    // Swallowed deliberately: the account exists and the player can resend.
  }

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

// ---------------------------------------------------------------- display

/**
 * Toggle team logos on or off for the season (D31).
 *
 * Colours are the default because they carry no trademark exposure. Logos are a
 * deliberate opt-in the commissioner can switch off in one click if the pool
 * ever becomes public-facing.
 */
export async function toggleTeamLogos(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };

  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const enable = formData.get("enable") === "true";

  await db.update(seasons).set({ showTeamLogos: enable }).where(eq(seasons.id, season.id));
  await db.insert(auditEvents).values({
    actorUserId: user.id,
    action: "season.toggle_logos",
    entityType: "season",
    entityId: season.id,
    before: { showTeamLogos: !enable },
    after: { showTeamLogos: enable },
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: enable ? "Logos on." : "Colours on." };
}

/** Pull teams, schedule, scores and candidate lines from the provider. */
export async function runSync(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };

  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const weekNumber = Number(formData.get("weekNumber") ?? 1);

  try {
    const { syncTeams, syncWeek } = await import("@/lib/sync");
    const teamResult = await syncTeams();
    const weekResult = await syncWeek(season.id, season.year, weekNumber, season.config);

    await db.insert(auditEvents).values({
      actorUserId: user.id,
      action: "sync.run",
      entityType: "season",
      entityId: season.id,
      after: { weekNumber, ...teamResult, ...weekResult },
    });

    revalidatePath("/admin");
    return {
      ok: `Synced ${teamResult.teamsUpserted} teams, ${weekResult.gamesUpserted} games and ${weekResult.linesCaptured} lines for Week ${weekNumber}.`,
    };
  } catch (error) {
    return {
      error: `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------- password

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (next !== confirm) return { error: "The two new passwords do not match." };

  const result = await changePasswordFor(user.id, current, next);
  if (!result.ok) return { error: result.message };

  await db.insert(auditEvents).values({
    actorUserId: user.id,
    action: "user.password_change",
    entityType: "user",
    entityId: user.id,
    reason: "Changed own password",
  });

  return { ok: "Password changed. Any other devices you were signed in on have been signed out." };
}

/**
 * Start a reset.
 *
 * Always reports success, even for an unknown address. Saying "no such account"
 * would let anyone test whether a given person is in the league.
 */
export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const sameAnswerEitherWay =
    "If that address has an account, a reset link is on its way. The link is good for one hour.";

  if (!email.includes("@")) return { error: "Enter a valid email address." };

  const reset = await createPasswordReset(email);
  if (!reset) return { ok: sameAnswerEitherWay };

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    `http://${requestHeaders.get("host") ?? "localhost:3000"}`;
  const link = `${origin}/reset/${reset.token}`;

  const { sendEmail } = await import("@/lib/mail");
  await sendEmail({
    to: reset.email,
    type: "password_reset",
    subject: "Reset your Survivor League password",
    html: `
      <p>Hi ${reset.firstName},</p>
      <p>Someone asked to reset the password for your Survivor League account.</p>
      <p><a href="${link}">Choose a new password</a></p>
      <p>This link works once and expires in one hour.</p>
      <p>If this wasn't you, ignore this email — nothing has changed.</p>
      <p style="color:#666;font-size:12px">${link}</p>
    `,
  });

  return { ok: sameAnswerEitherWay };
}

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (next !== confirm) return { error: "The two passwords do not match." };

  const result = await consumePasswordReset(token, next);
  if (!result.ok) return { error: result.message };

  await db.insert(auditEvents).values({
    actorUserId: result.userId,
    action: "user.password_reset",
    entityType: "user",
    entityId: result.userId,
    reason: "Password reset via emailed link",
  });

  redirect("/login?reset=1");
}

// ---------------------------------------------------------------- picks

/**
 * Make, change, or clear a pick.
 *
 * Everything that decides legality — team reuse, lock times, entry status —
 * is evaluated server-side through the rule engine. The button in the browser
 * only expresses intent.
 */
export async function choosePick(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const teamId = String(formData.get("teamId") ?? "");
  const weekNumber = Number(formData.get("weekNumber") ?? 0);
  if (!teamId || !weekNumber) return { error: "Missing team or week." };

  const { entryForUser } = await import("@/lib/season");
  const entry = await entryForUser(user.id, season.id);
  if (!entry) return { error: "You do not have an entry in this season." };

  const { submitPick } = await import("@/lib/picks");
  const result = await submitPick(entry.id, season.id, weekNumber, teamId, season.config);

  if (!result.ok) return { error: result.message };

  revalidatePath("/week");
  revalidatePath("/dashboard");

  const wording = {
    added: `${teamId} is your pick.`,
    replaced: `Pick changed to ${teamId}.`,
    removed: `${teamId} removed. You have no pick for this week yet.`,
  } as const;

  return { ok: wording[result.action] };
}

// ---------------------------------------------------------------- weekly processing

/** Lock this week's league lines, freezing them for every later decision (D10). */
export async function lockLines(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };

  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const weekNumber = Number(formData.get("weekNumber") ?? 0);
  const { db: database } = await import("@/db/client");
  const { weeks } = await import("@/db/schema");
  const { and: andOp, eq: eqOp } = await import("drizzle-orm");

  const [week] = await database
    .select()
    .from(weeks)
    .where(andOp(eqOp(weeks.seasonId, season.id), eqOp(weeks.weekNumber, weekNumber)))
    .limit(1);
  if (!week) return { error: `Week ${weekNumber} has not been loaded.` };

  const { lockLeagueLines } = await import("@/lib/sync");
  const result = await lockLeagueLines(week.id, user.id);

  await db.insert(auditEvents).values({
    actorUserId: user.id,
    action: "odds.lock",
    entityType: "week",
    entityId: week.id,
    after: { weekNumber, locked: result.locked, missing: result.missing },
  });

  revalidatePath("/admin");
  revalidatePath("/week");

  if (result.missing.length > 0) {
    return {
      ok: `Locked ${result.locked} lines. NO LINE for: ${result.missing.join(", ")} — these need a manual line before default picks can run.`,
    };
  }
  return { ok: `Locked ${result.locked} league lines for Week ${weekNumber}.` };
}

/** Assign default picks to anyone short of their requirement. */
export async function runDefaults(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };
  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const weekNumber = Number(formData.get("weekNumber") ?? 0);
  const { assignDefaultPicks } = await import("@/lib/processing");
  const report = await assignDefaultPicks(season.id, weekNumber, season.config);

  revalidatePath("/admin");
  revalidatePath("/week");

  if (!report.ran) return { error: report.skippedReason ?? "Did not run." };
  return {
    ok: `Assigned ${report.defaultsAssigned} default pick(s).${
      report.exceptions.length ? ` ${report.exceptions.length} exception(s) raised.` : ""
    }`,
  };
}

/** Grade the week and advance every entry. */
export async function runResults(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };
  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const weekNumber = Number(formData.get("weekNumber") ?? 0);
  const { processWeekResults } = await import("@/lib/processing");
  const report = await processWeekResults(season.id, weekNumber, season.config);

  await db.insert(auditEvents).values({
    actorUserId: user.id,
    action: "results.process",
    entityType: "season",
    entityId: season.id,
    after: { weekNumber, ...report },
  });

  revalidatePath("/admin");
  revalidatePath("/week");
  revalidatePath("/dashboard");

  if (!report.ran) return { error: report.skippedReason ?? "Did not run." };

  const parts = [
    `${report.entriesProcessed} entries processed`,
    `${report.survived} survived`,
    `${report.rebuysOffered} rebuy offer(s)`,
    `${report.eliminated} eliminated`,
  ];
  if (report.pending > 0) parts.push(`${report.pending} still waiting on unfinished games`);
  if (report.defaultsAssigned > 0) parts.unshift(`${report.defaultsAssigned} defaults assigned`);

  return { ok: `${parts.join(", ")}.` };
}

// ---------------------------------------------------------------- rebuys

async function myEntry() {
  const user = await currentUser();
  if (!user) return null;
  const season = await currentSeason();
  if (!season) return null;
  const { entryForUser } = await import("@/lib/season");
  const entry = await entryForUser(user.id, season.id);
  return entry ? { user, season, entry } : null;
}

export async function takeRebuy(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await myEntry();
  if (!ctx) return { error: "Sign in first." };

  const rebuyId = String(formData.get("rebuyId") ?? "");
  const decision = String(formData.get("decision") ?? "accept");

  const { acceptRebuy, declineRebuy } = await import("@/lib/rebuy-flow");
  const result =
    decision === "decline"
      ? await declineRebuy(rebuyId, ctx.entry.id)
      : await acceptRebuy(rebuyId, ctx.entry.id, ctx.season.id, ctx.season.config);

  revalidatePath("/dashboard");
  return result.ok ? { ok: result.message } : { error: result.message };
}

export async function confirmRebuy(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };
  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const rebuyId = String(formData.get("rebuyId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim() || null;

  const { confirmRebuyPayment } = await import("@/lib/rebuy-flow");
  const result = await confirmRebuyPayment(rebuyId, user.id, season.id, season.config, reference);

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return result.ok ? { ok: result.message } : { error: result.message };
}

// ---------------------------------------------------------------- split vote

export async function proposeSplit(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await myEntry();
  if (!ctx) return { error: "Sign in first." };

  const { survivorsFor, openProposal } = await import("@/lib/splits");
  const survivors = await survivorsFor(ctx.season.id);

  const allocations = survivors.map((s) => ({
    entryId: s.entryId,
    amountCents: Math.round(Number(formData.get(`amount-${s.entryId}`) ?? 0) * 100),
  }));

  const note = String(formData.get("note") ?? "").trim() || null;

  // Closes when the next week begins; falls back to seven days if the schedule
  // for the next week has not been loaded yet (D19a).
  const { loadSlate } = await import("@/lib/slate");
  const nextWeek = await loadSlate(ctx.season.id, (ctx.season.currentWeek ?? 1) + 1, ctx.season.config);
  const closesAt = nextWeek?.startsAt ?? new Date(Date.now() + 7 * 86_400_000);

  const result = await openProposal(
    ctx.season.id,
    ctx.entry.id,
    ctx.season.currentWeek ?? 1,
    allocations,
    note,
    closesAt,
  );

  revalidatePath("/split");
  return result.ok
    ? { ok: "Proposal opened. Everyone still alive has to agree, and silence counts as no." }
    : { error: result.message };
}

export async function voteOnSplit(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await myEntry();
  if (!ctx) return { error: "Sign in first." };

  const proposalId = String(formData.get("proposalId") ?? "");
  const response = String(formData.get("response") ?? "no") === "yes" ? "yes" : "no";

  const { castBallot, settleProposal } = await import("@/lib/splits");
  const result = await castBallot(proposalId, ctx.entry.id, response);
  if (!result.ok) return { error: result.message };

  // A yes may have completed unanimity; settling immediately avoids leaving the
  // season in a decided-but-unrecorded state.
  if (response === "yes") await settleProposal(ctx.season.id);

  revalidatePath("/split");
  revalidatePath("/dashboard");
  return { ok: result.message };
}

// ---------------------------------------------------------------- reminders

export async function sendReminder(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };
  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const weekNumber = Number(formData.get("weekNumber") ?? 1);
  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ?? `http://${requestHeaders.get("host") ?? "localhost:3000"}`;

  const { sendWeeklyReminder } = await import("@/lib/reminders");
  const report = await sendWeeklyReminder(season.id, season.name, weekNumber, season.config, origin);

  revalidatePath("/admin");
  if (report.skippedReason) return { error: report.skippedReason };
  return {
    ok: `Sent ${report.sent} reminder(s)${report.failed ? `, ${report.failed} failed` : ""}. Locally these are written to ./tmp/mail.`,
  };
}

// ---------------------------------------------------------------- verification

export async function resendVerification(_prev: FormState, _data: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ?? `http://${requestHeaders.get("host") ?? "localhost:3000"}`;

  const { sendVerificationEmail } = await import("@/lib/verification");
  const result = await sendVerificationEmail(user.id, origin);

  revalidatePath("/dashboard");
  return result.sent
    ? { ok: `Confirmation sent to ${user.email}. Locally it is written to ./tmp/mail.` }
    : { error: result.error ?? "Could not send the confirmation email." };
}

// ---------------------------------------------------------------- payment nags

export async function runPaymentReminders(_prev: FormState, _data: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: "Commissioner only." };
  const season = await currentSeason();
  if (!season) return { error: "No season configured." };

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ?? `http://${requestHeaders.get("host") ?? "localhost:3000"}`;

  const { loadSlate } = await import("@/lib/slate");
  const slate = await loadSlate(season.id, season.currentWeek ?? 1, season.config);

  const { sendPaymentReminders } = await import("@/lib/payment-nag");
  const report = await sendPaymentReminders(season, origin, new Date(), slate?.startsAt ?? null);

  await db.insert(auditEvents).values({
    actorUserId: user.id,
    action: "payments.remind",
    entityType: "season",
    entityId: season.id,
    after: { sent: report.sent, failed: report.failed, skipped: report.skipped },
  });

  revalidatePath("/admin");

  if (report.sent === 0 && report.failed === 0) {
    return { ok: report.details[0] ?? "Nobody was due a reminder." };
  }
  return {
    ok: `Sent ${report.sent}${report.failed ? `, ${report.failed} failed` : ""}. ${report.details.join(" · ")}`,
  };
}
