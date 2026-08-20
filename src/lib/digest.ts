/**
 * The two weekly round-up emails.
 *
 *   Sunday 1:00 PM ET  — who picked whom, now that everything is locked
 *   Monday 11:59 PM ET — what it all meant, once the last game is done
 *
 * TIMEZONE SAFETY. Vercel cron is UTC only, so "1 PM Eastern" is 17:00 UTC for
 * most of the season and 18:00 UTC after the November clock change. Both are
 * scheduled, and each job then checks the LOCAL hour before doing anything. The
 * schedule fires twice; the guard makes only the correct one act. Getting this
 * wrong on the Sunday email would send it an hour before the deadline and show
 * everyone a half-finished picture.
 *
 * IDEMPOTENT. Both take a run key, so a retry — or the duplicate DST firing —
 * cannot mail fifty people twice.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { entries, jobRuns, notifications, picks, users, weeks } from "@/db/schema";
import { sendEmail } from "@/lib/mail";
import { weekLabel } from "@/lib/season";
import { isAtOrAfterLocal, localTimeIn } from "@/lib/local-time";
import type { SeasonConfig } from "@/rules/config";

export interface DigestReport {
  sent: number;
  failed: number;
  skippedReason?: string;
}

function rowsFor(picksByEntry: Map<string, string[]>, players: Array<{ entryId: string; name: string; requiredPicks: number }>) {
  return players
    .map((p) => {
      const made = picksByEntry.get(p.entryId) ?? [];
      const short = made.length < p.requiredPicks;
      const cell = made.length > 0 ? made.join(", ") : "<em>no pick</em>";
      const owed =
        p.requiredPicks > 1 ? ` <span style="color:#78350f">(owes ${p.requiredPicks})</span>` : "";
      return `<tr${short ? ' style="background:#fee2e2"' : ""}>
        <td style="padding:4px 8px">${p.name}</td>
        <td style="padding:4px 8px">${cell}${owed}</td>
      </tr>`;
    })
    .join("");
}

async function loadWeek(seasonId: string, weekNumber: number) {
  const [week] = await db
    .select({ id: weeks.id, sundayDeadlineAt: weeks.sundayDeadlineAt })
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);
  return week ?? null;
}

async function activePlayers(seasonId: string) {
  return db
    .select({
      entryId: entries.id,
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      requiredPicks: entries.requiredPicks,
      status: entries.status,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(eq(entries.seasonId, seasonId));
}

async function mailEveryone(
  recipients: Array<{ userId: string; email: string; firstName: string }>,
  subject: string,
  bodyFor: (firstName: string) => string,
  type: string,
  payload: Record<string, unknown>,
): Promise<DigestReport> {
  let sent = 0;
  let failed = 0;

  for (const person of recipients) {
    const result = await sendEmail({
      to: person.email,
      type,
      subject,
      html: bodyFor(person.firstName),
    });

    await db.insert(notifications).values({
      userId: person.userId,
      type,
      channel: "email",
      status: result.delivered ? "sent" : "failed",
      payload: { ...payload, transport: result.transport, error: result.error ?? null },
      sentAt: result.delivered ? new Date() : null,
    });

    if (result.delivered) sent += 1;
    else failed += 1;
  }

  return { sent, failed };
}

/**
 * Sunday 1:00 PM ET — the locked slate.
 *
 * Everything in here is already locked, so publishing it changes nothing about
 * the week. NOTE: this reveals a Monday-night pick roughly thirty hours before
 * the standings page would, since standings hold each pick until its own game
 * kicks off. That is a deliberate difference, not an oversight — the digest is
 * a snapshot of a closed slate.
 */
export async function sendSundayStatus(
  seasonId: string,
  seasonName: string,
  weekNumber: number,
  config: SeasonConfig,
  origin: string,
  seasonType = 2,
  now: Date = new Date(),
): Promise<DigestReport> {
  // Both UTC firings are scheduled because cron cannot say "1 PM Eastern".
  // This refuses the one that lands before 1 PM locally; the run key below
  // handles the one that lands after.
  const local = localTimeIn(config.timezone, now);
  if (!isAtOrAfterLocal(config.timezone, now, 13)) {
    return {
      sent: 0,
      failed: 0,
      skippedReason: `Local time is ${local.hour}:${String(local.minute).padStart(2, "0")} — before the 1 PM send. Picks may still be open.`,
    };
  }

  const runKey = `sunday-status:${seasonId}:week-${weekNumber}`;
  try {
    await db.insert(jobRuns).values({ runKey, jobName: "sunday-status" });
  } catch {
    return { sent: 0, failed: 0, skippedReason: "Already sent for this week." };
  }

  const week = await loadWeek(seasonId, weekNumber);
  if (!week) return { sent: 0, failed: 0, skippedReason: `Week ${weekNumber} is not loaded.` };

  const everyone = await activePlayers(seasonId);
  const alive = everyone.filter((p) => p.status === "active");
  if (alive.length === 0) return { sent: 0, failed: 0, skippedReason: "Nobody is active." };

  const made = await db
    .select({ entryId: picks.entryId, teamId: picks.teamId, source: picks.source })
    .from(picks)
    .where(eq(picks.weekId, week.id));

  const byEntry = new Map<string, string[]>();
  for (const m of made) {
    const list = byEntry.get(m.entryId) ?? [];
    list.push(m.source === "default" ? `${m.teamId} (auto)` : m.teamId);
    byEntry.set(m.entryId, list);
  }

  const players = alive.map((p) => ({
    entryId: p.entryId,
    name: `${p.firstName} ${p.lastName}`,
    requiredPicks: p.requiredPicks,
  }));
  players.sort((a, b) => a.name.localeCompare(b.name));

  const label = weekLabel(seasonType, weekNumber);
  const missing = players.filter((p) => (byEntry.get(p.entryId) ?? []).length < p.requiredPicks);
  const autoCount = made.filter((m) => m.source === "default").length;

  const html = (firstName: string) => `
    <p>${firstName},</p>
    <p>Picks for <strong>${label}</strong> are locked. Here is where everyone stands.</p>
    <p>
      ${players.length} still alive.
      ${autoCount > 0 ? `${autoCount} automatic pick${autoCount === 1 ? "" : "s"} were assigned to people who missed the deadline.` : "Everyone got their pick in."}
      ${missing.length > 0 ? `<strong style="color:#7f1d1d">${missing.length} still without a pick.</strong>` : ""}
    </p>
    <table style="border-collapse:collapse;font-size:14px;border:1px solid #d8dce3">
      <tr><th align="left" style="padding:4px 8px">Player</th><th align="left" style="padding:4px 8px">Pick</th></tr>
      ${rowsFor(byEntry, players)}
    </table>
    <p><a href="${origin}/standings">Full standings</a></p>
    <p style="color:#5b6472;font-size:13px">
      Good luck. Results and what they mean go out after the Monday night game.
    </p>
  `;

  return mailEveryone(alive, `${seasonName} — ${label} picks are locked`, html, "sunday_status", {
    weekNumber,
  });
}

/**
 * Monday 11:59 PM ET — the recap.
 *
 * Read only. It reports what results processing already decided rather than
 * deciding anything itself, so a late or failed grading run produces an honest
 * "not graded yet" instead of a confidently wrong email.
 */
export async function sendMondayRecap(
  seasonId: string,
  seasonName: string,
  weekNumber: number,
  config: SeasonConfig,
  origin: string,
  seasonType = 2,
  now: Date = new Date(),
): Promise<DigestReport> {
  const local = localTimeIn(config.timezone, now);
  // Guard the DST twin: only the firing that lands late on Monday evening acts.
  // The wrong twin lands either at 10:59 PM Monday or 12:59 AM Tuesday, and
  // both fail this check.
  if (!isAtOrAfterLocal(config.timezone, now, 23)) {
    return {
      sent: 0,
      failed: 0,
      skippedReason: `Local time is ${local.hour}:${String(local.minute).padStart(2, "0")} — before the 11:59 PM send.`,
    };
  }

  const runKey = `monday-recap:${seasonId}:week-${weekNumber}`;
  try {
    await db.insert(jobRuns).values({ runKey, jobName: "monday-recap" });
  } catch {
    return { sent: 0, failed: 0, skippedReason: "Already sent for this week." };
  }

  const week = await loadWeek(seasonId, weekNumber);
  if (!week) return { sent: 0, failed: 0, skippedReason: `Week ${weekNumber} is not loaded.` };

  const graded = await db
    .select({
      entryId: picks.entryId,
      teamId: picks.teamId,
      outcome: picks.outcome,
      source: picks.source,
    })
    .from(picks)
    .where(eq(picks.weekId, week.id));

  const stillPending = graded.filter((g) => g.outcome === "pending").length;
  if (graded.length > 0 && stillPending === graded.length) {
    // Delete the run key so tomorrow's firing can try again — nothing was sent.
    await db.delete(jobRuns).where(eq(jobRuns.runKey, runKey));
    return {
      sent: 0,
      failed: 0,
      skippedReason: "Results have not been processed yet. Nothing to recap.",
    };
  }

  const everyone = await activePlayers(seasonId);
  const byEntry = new Map(everyone.map((p) => [p.entryId, p]));

  const outThisWeek = everyone.filter((p) => p.status === "eliminated");
  const owedRebuy = everyone.filter((p) => p.status === "rebuy_pending");
  const alive = everyone.filter((p) => p.status === "active");
  const owingMore = alive.filter((p) => p.requiredPicks > 1);
  const autoPicked = graded.filter((g) => g.source === "default");

  const name = (entryId: string) => {
    const p = byEntry.get(entryId);
    return p ? `${p.firstName} ${p.lastName}` : "someone";
  };

  const label = weekLabel(seasonType, weekNumber);
  const lost = graded.filter((g) => g.outcome === "loss");
  const tied = graded.filter((g) => g.outcome === "tie");

  const list = (items: string[]) =>
    items.length > 0 ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "";

  const html = (firstName: string) => `
    <p>${firstName},</p>
    <h3 style="margin-bottom:4px">${label} is done</h3>
    <p><strong>${alive.length}</strong> still alive.</p>

    ${
      lost.length > 0
        ? `<h4 style="margin-bottom:4px">Lost this week</h4>${list(
            lost.map((g) => `${name(g.entryId)} — ${g.teamId}`),
          )}`
        : "<p>Nobody lost this week.</p>"
    }

    ${
      tied.length > 0
        ? `<h4 style="margin-bottom:4px">Tied — still alive, but the price went up</h4>${list(
            tied.map((g) => `${name(g.entryId)} — ${g.teamId}`),
          )}
           <p style="color:#78350f">A tie means picking ${config.tieMultiplier} winners next week. Any one of them losing ends the entry.</p>`
        : ""
    }

    ${
      owedRebuy.length > 0
        ? `<h4 style="margin-bottom:4px">Rebuy available</h4>${list(
            owedRebuy.map((p) => `${p.firstName} ${p.lastName}`),
          )}
           <p>If that is you, take it from your dashboard. A rebuy does <strong>not</strong> give your used teams back.</p>`
        : ""
    }

    ${
      owingMore.length > 0
        ? `<h4 style="margin-bottom:4px">Owing more than one pick next week</h4>${list(
            owingMore.map((p) => `${p.firstName} ${p.lastName} — ${p.requiredPicks} winners`),
          )}`
        : ""
    }

    ${
      outThisWeek.length > 0
        ? `<h4 style="margin-bottom:4px">Out</h4>${list(
            outThisWeek.map((p) => `${p.firstName} ${p.lastName}`),
          )}`
        : ""
    }

    ${
      autoPicked.length > 0
        ? `<p style="color:#5b6472">${autoPicked.length} pick${autoPicked.length === 1 ? " was" : "s were"} assigned automatically to people who missed the deadline.</p>`
        : ""
    }

    <p><a href="${origin}/standings">Standings</a> · <a href="${origin}/week">Next week</a></p>
  `;

  const recipients = everyone.filter((p) => p.status !== "registered" && p.status !== "paid");
  if (recipients.length === 0) return { sent: 0, failed: 0, skippedReason: "Nobody to write to." };

  return mailEveryone(recipients, `${seasonName} — ${label} recap`, html, "monday_recap", {
    weekNumber,
    alive: alive.length,
    out: outThisWeek.length,
  });
}
