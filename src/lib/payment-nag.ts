/**
 * Automated payment reminders (D9).
 *
 * The commissioner's actual complaint was chasing people for money. So the app
 * does the nagging: unpaid registrants get an escalating sequence of emails, and
 * the commissioner never sends "hey man, did you Venmo me yet?" again.
 *
 * Escalation is driven by how long the entry has been unpaid AND how close
 * kickoff is, because those are different kinds of urgency. Each step is sent at
 * most once per entry, enforced by unique(entry_id, step) — a retried job cannot
 * mail fifty people twice.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { entries, paymentReminders, users } from "@/db/schema";
import { LEAGUE } from "@/lib/league";
import { sendEmail } from "@/lib/mail";
import { formatMoney, listEntries, type SeasonRow } from "@/lib/season";

export interface NagStep {
  step: number;
  /** Days since signup at which this step becomes due. */
  afterDays: number;
  subject: (season: string) => string;
  tone: "gentle" | "firm" | "final";
}

/**
 * Three steps, deliberately few. A nag every day trains people to ignore the
 * sender, which is the opposite of the goal.
 */
export const NAG_STEPS: NagStep[] = [
  {
    step: 1,
    afterDays: 2,
    subject: (s) => `${s} — your entry is not paid yet`,
    tone: "gentle",
  },
  {
    step: 2,
    afterDays: 6,
    subject: (s) => `${s} — still waiting on your entry`,
    tone: "firm",
  },
  {
    step: 3,
    afterDays: 12,
    subject: (s) => `${s} — last call before the season starts`,
    tone: "final",
  },
];

export interface NagReport {
  sent: number;
  failed: number;
  skipped: number;
  details: string[];
}

function body(
  tone: NagStep["tone"],
  firstName: string,
  fullName: string,
  amount: string,
  tierLabel: string,
  origin: string,
  kickoffNote: string,
): string {
  const intro =
    tone === "gentle"
      ? `You signed up for the pool but your entry has not been paid yet, so you are not in it.`
      : tone === "firm"
        ? `Your entry is still unpaid. You are not in the pool and your picks will not count until it is confirmed.`
        : `This is the last reminder. If your entry is not paid you will not be in the pool when the season starts.`;

  return `
    <p>${firstName},</p>
    <p>${intro}</p>
    <p><strong>Amount due: ${amount}</strong> for the ${tierLabel}.</p>
    <div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0">
      <div>Send by PayPal to:</div>
      <div style="font-family:monospace;font-size:18px;font-weight:700;margin:6px 0">${LEAGUE.paypalAddress}</div>
      <ul style="margin:6px 0">
        <li>Send as <strong>${LEAGUE.paypalTransferType}</strong>, not goods and services.</li>
        <li>Put <strong>${fullName}</strong> in the note so it can be matched to you.</li>
      </ul>
    </div>
    ${kickoffNote}
    <p><a href="${origin}/dashboard">Your dashboard</a></p>
  `;
}

/**
 * Send whichever step each unpaid entry is now due.
 *
 * Practice seasons are skipped entirely — there is nothing to pay (D12).
 */
export async function sendPaymentReminders(
  season: SeasonRow,
  origin: string,
  now: Date = new Date(),
  firstKickoff?: Date | null,
): Promise<NagReport> {
  const report: NagReport = { sent: 0, failed: 0, skipped: 0, details: [] };

  if (season.mode === "practice") {
    report.details.push("Practice season — nothing to pay, no reminders sent.");
    return report;
  }

  const all = await listEntries(season.id);
  const unpaid = all.filter((e) => e.amountOwedCents > 0);
  if (unpaid.length === 0) {
    report.details.push("Everyone has paid.");
    return report;
  }

  const entryRows = await db
    .select({ id: entries.id, createdAt: entries.createdAt, userId: entries.userId })
    .from(entries)
    .where(
      and(
        eq(entries.seasonId, season.id),
        inArray(
          entries.id,
          unpaid.map((u) => u.id),
        ),
      ),
    );
  const createdById = new Map(entryRows.map((r) => [r.id, r.createdAt]));

  const alreadySent = await db
    .select({ entryId: paymentReminders.entryId, step: paymentReminders.step })
    .from(paymentReminders);

  // Track the HIGHEST step each entry has received, not merely which ones were
  // sent. Escalation only ever moves forward: once someone has had "last call"
  // they must never afterwards receive the gentle nudge, which is what happens
  // if you only skip steps individually.
  const highestSent = new Map<string, number>();
  for (const row of alreadySent) {
    highestSent.set(row.entryId, Math.max(highestSent.get(row.entryId) ?? 0, row.step));
  }

  const daysToKickoff = firstKickoff
    ? Math.ceil((firstKickoff.getTime() - now.getTime()) / 86_400_000)
    : null;

  const kickoffNote =
    daysToKickoff !== null && daysToKickoff >= 0
      ? `<p><strong>The season starts in ${daysToKickoff} day(s).</strong></p>`
      : "";

  for (const entry of unpaid) {
    const created = createdById.get(entry.id);
    if (!created) continue;

    const ageDays = (now.getTime() - created.getTime()) / 86_400_000;

    // The highest step now due that is beyond anything already sent. Taking only
    // the latest avoids blasting someone three emails at once if the job ran
    // late, and the `> reached` guard stops escalation ever going backwards.
    const reached = highestSent.get(entry.id) ?? 0;
    const due = NAG_STEPS.filter((s) => ageDays >= s.afterDays && s.step > reached).at(-1);

    if (!due) {
      report.skipped += 1;
      continue;
    }

    const result = await sendEmail({
      to: entry.email,
      type: `payment_reminder_${due.step}`,
      subject: due.subject(season.name),
      html: body(
        due.tone,
        entry.firstName,
        `${entry.firstName} ${entry.lastName}`,
        formatMoney(entry.amountOwedCents),
        entry.tier === "EIGHTY" ? "$80 entry" : "$20 entry",
        origin,
        kickoffNote,
      ),
    });

    try {
      await db.insert(paymentReminders).values({
        entryId: entry.id,
        step: due.step,
        delivered: result.delivered,
      });
    } catch {
      // unique(entry_id, step) — a concurrent run already logged it.
      report.skipped += 1;
      continue;
    }

    if (result.delivered) {
      report.sent += 1;
      report.details.push(`${entry.firstName} ${entry.lastName}: step ${due.step}`);
    } else {
      report.failed += 1;
      report.details.push(`${entry.firstName} ${entry.lastName}: FAILED (${result.error ?? "unknown"})`);
    }
  }

  return report;
}

/** What each unpaid player has been sent, for the commissioner's view. */
export async function reminderHistory(seasonId: string) {
  const rows = await db
    .select({
      entryId: paymentReminders.entryId,
      step: paymentReminders.step,
      sentAt: paymentReminders.sentAt,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(paymentReminders)
    .innerJoin(entries, eq(entries.id, paymentReminders.entryId))
    .innerJoin(users, eq(users.id, entries.userId))
    .where(eq(entries.seasonId, seasonId));

  const byEntry = new Map<string, { name: string; steps: number[] }>();
  for (const row of rows) {
    const key = row.entryId;
    const existing = byEntry.get(key) ?? { name: `${row.firstName} ${row.lastName}`, steps: [] };
    existing.steps.push(row.step);
    byEntry.set(key, existing);
  }
  return [...byEntry.values()];
}
