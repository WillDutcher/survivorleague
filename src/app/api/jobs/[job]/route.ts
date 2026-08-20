/**
 * Scheduled job endpoints.
 *
 * Called by Vercel Cron on the schedule in vercel.json (D36).
 *
 * SECURITY
 * These endpoints move money-adjacent state: they assign picks, grade results,
 * eliminate players and send mail. They are protected by a shared secret in the
 * Authorization header, compared in constant time. No secret configured means
 * every request is refused — failing closed, never open.
 *
 * Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`, so both GET
 * and POST run the job and either secret is accepted. POST stays supported so a
 * job can be triggered by hand without pretending to be the scheduler.
 *
 * IDEMPOTENCE
 * Every job underneath is safe to run twice; that is a property of the jobs
 * themselves, not of the scheduler. A retry, a double fire, or a manual trigger
 * on top of a scheduled one cannot double-charge a rebuy, eliminate anyone
 * twice, or send fifty people a second email.
 */

import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type JobName =
  | "sync-odds"
  | "assign-defaults"
  | "process-results"
  | "weekly-reminder"
  | "sunday-status"
  | "monday-recap"
  | "payment-reminders"
  | "close-splits";

const JOBS: JobName[] = [
  "sync-odds",
  "assign-defaults",
  "process-results",
  "weekly-reminder",
  "sunday-status",
  "monday-recap",
  "payment-reminders",
  "close-splits",
];

function matches(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!provided) return false;

  // Either secret works: CRON_SECRET is what Vercel Cron sends,
  // JOB_TRIGGER_SECRET is for triggering a job by hand.
  // Fail closed — with neither configured, nothing is authorized.
  return (
    matches(provided, process.env.CRON_SECRET) ||
    matches(provided, process.env.JOB_TRIGGER_SECRET)
  );
}

async function runJob(
  request: Request,
  context: { params: Promise<{ job: string }> },
) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await context.params;
  if (!JOBS.includes(job as JobName)) {
    return NextResponse.json(
      { error: `Unknown job "${job}".`, known: JOBS },
      { status: 404 },
    );
  }

  const { currentSeason } = await import("@/lib/season");
  const season = await currentSeason();
  if (!season) {
    return NextResponse.json({ error: "No active season." }, { status: 409 });
  }

  const origin = publicOrigin(new URL(request.url).origin);
  const week = season.currentWeek ?? 1;

  try {
    switch (job as JobName) {
      case "sync-odds": {
        const { syncScoresAndLines } = await import("@/lib/sync-oddsapi");
        const report = await syncScoresAndLines(season.id, season.config.timezone);
        return NextResponse.json({ job, week, ...report });
      }

      case "assign-defaults": {
        const { assignDefaultPicks } = await import("@/lib/processing");
        const report = await assignDefaultPicks(season.id, week, season.config);
        return NextResponse.json({ job, week, ...report });
      }

      case "process-results": {
        const { processWeekResults } = await import("@/lib/processing");
        const report = await processWeekResults(season.id, week, season.config);
        return NextResponse.json({ job, week, ...report });
      }

      case "weekly-reminder": {
        const { sendWeeklyReminder } = await import("@/lib/reminders");
        const report = await sendWeeklyReminder(
          season.id,
          season.name,
          week,
          season.config,
          origin,
          season.seasonType,
        );
        return NextResponse.json({ job, week, ...report });
      }

      case "sunday-status": {
        const { sendSundayStatus } = await import("@/lib/digest");
        const report = await sendSundayStatus(
          season.id,
          season.name,
          week,
          season.config,
          origin,
          season.seasonType,
        );
        return NextResponse.json({ job, week, ...report });
      }

      case "monday-recap": {
        const { sendMondayRecap } = await import("@/lib/digest");
        const report = await sendMondayRecap(
          season.id,
          season.name,
          week,
          season.config,
          origin,
          season.seasonType,
        );
        return NextResponse.json({ job, week, ...report });
      }

      case "payment-reminders": {
        const { sendPaymentReminders } = await import("@/lib/payment-nag");
        const { loadSlate } = await import("@/lib/slate");
        const slate = await loadSlate(season.id, week, season.config);
        const report = await sendPaymentReminders(
          season,
          origin,
          new Date(),
          slate?.startsAt ?? null,
        );
        return NextResponse.json({ job, week, ...report });
      }

      case "close-splits": {
        const { closeExpiredProposals } = await import("@/lib/splits");
        const report = await closeExpiredProposals(season.id);
        return NextResponse.json({ job, week, ...report });
      }
    }
  } catch (error) {
    // Report the failure rather than swallowing it: the scheduler logs the
    // response, and a job that quietly fails every week is worse than one that
    // fails loudly once.
    return NextResponse.json(
      { job, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// Vercel Cron issues GET; manual triggers use POST. Both do the same work.
export const GET = runJob;
export const POST = runJob;
