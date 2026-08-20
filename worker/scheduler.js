/**
 * Scheduler — Cloudflare Worker.
 *
 * Vercel's free tier caps cron at once per day, which cannot run a job at
 * 12:59 on a Sunday. Cloudflare cron triggers are free and minute-accurate, so
 * the schedule lives here and simply calls the app's job endpoints.
 *
 * This is unrelated to the ESPN proxy that failed (D35). That needed to reach
 * ESPN, which blocks Cloudflare. This only needs to reach the Survivor League
 * app, which is ordinary HTTPS to Vercel.
 *
 * ALL TIMES IN CRON TRIGGERS ARE UTC. Cloudflare does not do timezones, and the
 * league runs on Eastern, which shifts by an hour at DST. Both offsets are
 * therefore scheduled, and the jobs themselves are idempotent, so the duplicate
 * firing that happens for half the year is harmless by design.
 *
 * SETUP
 *   1. Create a Worker named `survivor-scheduler`, paste this in, deploy.
 *   2. Settings -> Variables and Secrets:
 *        APP_URL     (plain text)  https://survivorleague-mu.vercel.app
 *        JOB_SECRET  (secret)      same value as JOB_TRIGGER_SECRET in Vercel
 *   3. Settings -> Trigger events -> Cron triggers, add the crons listed below.
 */

/**
 * Which jobs run on which schedule.
 *
 * Every entry is listed twice where it matters, at both EST and EDT offsets.
 * Running a job an hour "early" or "late" costs nothing because each one is
 * idempotent — but MISSING the Sunday deadline job would matter, so it is
 * deliberately over-scheduled rather than under.
 */
const SCHEDULE = {
  // Tue 09:00 ET — refresh scores and lines after the week completes.
  "0 13 * * 2": ["sync-odds", "process-results"],
  "0 14 * * 2": ["sync-odds", "process-results"],

  // Thu 10:00 ET — fresh lines ahead of the Thursday game, then the reminder.
  "0 14 * * 4": ["sync-odds"],
  "0 15 * * 4": ["sync-odds"],
  "0 18 * * 4": ["weekly-reminder"],
  "0 19 * * 4": ["weekly-reminder"],

  // Sun 12:59 ET — THE important one. Assign defaults before the main slate.
  // Four minutes after the 12:55 deadline, as the brief specifies.
  "59 16 * * 0": ["assign-defaults"],
  "59 17 * * 0": ["assign-defaults"],

  // Sun 20:00 and 23:30 ET — pick up afternoon and evening finals.
  "0 0 * * 1": ["sync-odds", "process-results"],
  "30 3 * * 1": ["sync-odds", "process-results"],
  "30 4 * * 1": ["sync-odds", "process-results"],

  // Tue 12:00 ET — chase unpaid entries, and close any expired split vote.
  "0 16 * * 2": ["payment-reminders", "close-splits"],
};

async function runJob(job, env) {
  const url = `${env.APP_URL.replace(/\/$/, "")}/api/jobs/${job}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.JOB_SECRET}`,
        "content-type": "application/json",
      },
    });
    const body = await response.text();
    return { job, status: response.status, body: body.slice(0, 500) };
  } catch (error) {
    return { job, status: 0, body: String(error) };
  }
}

export default {
  /** Fired by the cron triggers. */
  async scheduled(event, env, ctx) {
    const jobs = SCHEDULE[event.cron] ?? [];
    ctx.waitUntil(
      (async () => {
        for (const job of jobs) {
          // Sequential on purpose: process-results depends on sync-odds having
          // landed the scores first, and these are cheap.
          const result = await runJob(job, env);
          console.log(JSON.stringify({ cron: event.cron, ...result }));
        }
      })(),
    );
  },

  /**
   * Manual trigger, for testing and for running a job off-schedule.
   *   POST /run?job=sync-odds   with the same bearer secret
   */
  async fetch(request, env) {
    const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (!env.JOB_SECRET || provided !== env.JOB_SECRET) {
      return new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    const job = new URL(request.url).searchParams.get("job");
    if (!job) {
      return new Response(
        JSON.stringify({ schedule: SCHEDULE, usage: "POST /?job=<name> with bearer secret" }),
        { headers: { "content-type": "application/json" } },
      );
    }

    const result = await runJob(job, env);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.status === 200 ? 200 : 502,
      headers: { "content-type": "application/json" },
    });
  },
};
