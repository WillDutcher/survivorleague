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
import { entries, jobRuns, notifications, picks, users, weeks } from "@/db/schema";
import { sendEmail } from "@/lib/mail";
import { inLeagueTime, lineLabel, loadSlate } from "@/lib/slate";
import { weekLabel } from "@/lib/season";
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
  seasonType = 2,
): Promise<ReminderReport> {
  const label = weekLabel(seasonType, weekNumber);
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
      subject: `${seasonName} — ${label} picks due ${deadline}`,
      html: `
        <p>${person.firstName},</p>
        <p>${label} is open. Picks are due <strong>${deadline}</strong>.</p>
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

/**
 * A manual nudge to everyone who still owes a pick this week.
 *
 * Deliberately NOT idempotent, unlike sendWeeklyReminder: that one is a
 * scheduled job where a double-send is a bug, whereas this is a button the
 * commissioner presses precisely because the first reminder did not work. It
 * is safe to press twice because it re-checks who is actually short each time,
 * so anyone who has since picked drops out of the list.
 *
 * Picks are counted against requiredPicks, which a tie raises above one — a
 * player who owes two and has made one is still short and still gets nudged.
 */
export async function nudgeMissingPicks(
  seasonId: string,
  seasonName: string,
  weekNumber: number,
  config: SeasonConfig,
  origin: string,
  seasonType = 2,
): Promise<ReminderReport> {
  const label = weekLabel(seasonType, weekNumber);

  const slate = await loadSlate(seasonId, weekNumber, config);
  if (!slate) return { sent: 0, failed: 0, skippedReason: `Week ${weekNumber} is not loaded.` };

  const [weekRow] = await db
    .select({ id: weeks.id })
    .from(weeks)
    .where(and(eq(weeks.seasonId, seasonId), eq(weeks.weekNumber, weekNumber)))
    .limit(1);
  if (!weekRow) return { sent: 0, failed: 0, skippedReason: `Week ${weekNumber} is not loaded.` };

  const active = await db
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      entryId: entries.id,
      requiredPicks: entries.requiredPicks,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(and(eq(entries.seasonId, seasonId), eq(entries.status, "active")));

  const made = await db
    .select({ entryId: picks.entryId })
    .from(picks)
    .where(eq(picks.weekId, weekRow.id));

  const countByEntry = new Map<string, number>();
  for (const p of made) countByEntry.set(p.entryId, (countByEntry.get(p.entryId) ?? 0) + 1);

  const short = active.filter((a) => (countByEntry.get(a.entryId) ?? 0) < a.requiredPicks);
  if (short.length === 0) {
    return { sent: 0, failed: 0, skippedReason: "Everyone has already picked." };
  }

  const deadline = slate.sundayDeadlineAt
    ? inLeagueTime(slate.sundayDeadlineAt, config)
    : "the usual Sunday deadline";

  let sent = 0;
  let failed = 0;

  for (const person of short) {
    const owed = person.requiredPicks - (countByEntry.get(person.entryId) ?? 0);
    const owedLine =
      person.requiredPicks > 1
        ? `<p style="color:#9b1c1c"><strong>You tied, so this week needs ${person.requiredPicks} winning picks — you still owe ${owed}.</strong></p>`
        : "";

    const result = await sendEmail({
      to: person.email,
      type: "weekly_reminder",
      subject: `${seasonName} — you still have no pick for ${label}`,
      html: `
        <p>${person.firstName},</p>
        <p>You have not made your ${label} pick yet. Picks are due <strong>${deadline}</strong>.</p>
        ${owedLine}
        <p>If you miss the deadline you are assigned the strongest available favourite
           automatically, and you are stuck with whatever that turns out to be.</p>
        <p><a href="${origin}/week?week=${weekNumber}">Make your pick</a></p>
      `,
    });

    await db.insert(notifications).values({
      userId: person.userId,
      type: "weekly_reminder",
      channel: "email",
      status: result.delivered ? "sent" : "failed",
      payload: {
        weekNumber,
        manual: true,
        transport: result.transport,
        error: result.error ?? null,
      },
      sentAt: result.delivered ? new Date() : null,
    });

    if (result.delivered) sent += 1;
    else failed += 1;
  }

  return { sent, failed };
}
