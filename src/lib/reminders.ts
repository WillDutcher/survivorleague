/**
 * The Thursday reminder (PROJECT_BRIEF: historically a weekly email with games
 * and spreads).
 *
 * Idempotent by run key: a duplicate trigger must never send fifty people two
 * emails. Notifications are never the source of truth, so a send failure is
 * recorded and never rolls back league state.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { entries, jobRuns, notifications, users } from "@/db/schema";
import { sendEmail } from "@/lib/mail";
import { inLeagueTime, lineLabel, loadSlate } from "@/lib/slate";
import type { SeasonConfig } from "@/rules/config";

export interface ReminderReport {
  sent: number;
  failed: number;
  skippedReason?: string;
}

export async function sendWeeklyReminder(
  seasonId: string,
  seasonName: string,
  weekNumber: number,
  config: SeasonConfig,
  origin: string,
): Promise<ReminderReport> {
  const runKey = `reminder:${seasonId}:week-${weekNumber}`;
  try {
    await db.insert(jobRuns).values({ runKey, jobName: "weekly-reminder" });
  } catch {
    return { sent: 0, failed: 0, skippedReason: "Already sent for this week." };
  }

  const slate = await loadSlate(seasonId, weekNumber, config);
  if (!slate) return { sent: 0, failed: 0, skippedReason: `Week ${weekNumber} is not loaded.` };

  const recipients = await db
    .select({ email: users.email, firstName: users.firstName, requiredPicks: entries.requiredPicks })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(and(eq(entries.seasonId, seasonId), eq(entries.status, "active")));

  const deadline = slate.sundayDeadlineAt
    ? inLeagueTime(slate.sundayDeadlineAt, config)
    : "the usual Sunday deadline";

  const rows = slate.games
    .map((g) => {
      const line = lineLabel(g);
      return `<tr>
        <td style="padding:4px 8px">${g.away.id} at ${g.home.id}</td>
        <td style="padding:4px 8px">${inLeagueTime(g.kickoff, config)}</td>
        <td style="padding:4px 8px">${line ?? "&mdash;"}</td>
      </tr>`;
    })
    .join("");

  let sent = 0;
  let failed = 0;

  for (const person of recipients) {
    const owed =
      person.requiredPicks > 1
        ? `<p style="color:#9b1c1c"><strong>You tied, so this week you must pick ${person.requiredPicks} winners.</strong> A single loss ends your entry.</p>`
        : "";

    const result = await sendEmail({
      to: person.email,
      type: "weekly_reminder",
      subject: `${seasonName} — Week ${weekNumber} picks due ${deadline}`,
      html: `
        <p>${person.firstName},</p>
        <p>Week ${weekNumber} is open. Picks are due <strong>${deadline}</strong>.</p>
        ${owed}
        <p>If you miss the deadline you are assigned the strongest available favourite automatically.</p>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><th align="left" style="padding:4px 8px">Game</th><th align="left" style="padding:4px 8px">Kickoff</th><th align="left" style="padding:4px 8px">Line</th></tr>
          ${rows}
        </table>
        <p><a href="${origin}/week?week=${weekNumber}">Make your pick</a></p>
      `,
    });

    await db.insert(notifications).values({
      userId: (
        await db.select({ id: users.id }).from(users).where(eq(users.email, person.email)).limit(1)
      )[0]!.id,
      type: "weekly_reminder",
      channel: "email",
      status: result.delivered ? "sent" : "failed",
      payload: { weekNumber, transport: result.transport, error: result.error ?? null },
      sentAt: result.delivered ? new Date() : null,
    });

    if (result.delivered) sent += 1;
    else failed += 1;
  }

  await db
    .update(jobRuns)
    .set({ completedAt: new Date(), result: { sent, failed } })
    .where(eq(jobRuns.runKey, runKey));

  return { sent, failed };
}
