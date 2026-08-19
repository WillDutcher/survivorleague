import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Environment and league health.
 *
 * Two different questions, deliberately separated:
 *
 *   ENVIRONMENT — is this install wired up correctly? Fixed by a command.
 *   LEAGUE      — is the season ready to run this week? Fixed by an action in
 *                 commissioner tools.
 *
 * The second half is the one that matters in-season: lines unlocked before
 * defaults run, an unresolved sync exception, or someone stuck awaiting payment
 * are all silent problems that only surface when it is too late.
 */

type Level = "ok" | "warn" | "bad" | "info";

interface Check {
  label: string;
  level: Level;
  detail: string;
  fix?: string;
  fixHref?: string;
}

function statusClass(level: Level): string {
  return level === "ok" ? "status-ok" : level === "info" ? "muted" : "status-bad";
}

function statusWord(level: Level): string {
  switch (level) {
    case "ok":
      return "OK";
    case "warn":
      return "Attention";
    case "bad":
      return "Problem";
    default:
      return "Info";
  }
}

async function environmentChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const url = process.env.DATABASE_URL;

  checks.push({
    label: "DATABASE_URL is set",
    level: url ? "ok" : "bad",
    detail: url ? "Found in environment." : "Not set.",
    fix: url ? undefined : "cp .env.example .env.local",
  });

  if (url) {
    try {
      const { sql } = await import("@/db/client");
      const [row] = await sql<{ version: string }[]>`select version() as version`;
      checks.push({
        label: "Database reachable",
        level: "ok",
        detail: row?.version?.split(",")[0] ?? "Connected.",
      });

      const [tables] = await sql<{ count: number }[]>`
        select count(*)::int as count from information_schema.tables where table_schema = 'public'
      `;
      const tableCount = tables?.count ?? 0;
      checks.push({
        label: "Migrations applied",
        level: tableCount > 0 ? "ok" : "bad",
        detail: tableCount > 0 ? `${tableCount} tables present.` : "Database is reachable but empty.",
        fix: tableCount > 0 ? undefined : "npm run db:migrate",
      });
    } catch (error) {
      checks.push({
        label: "Database reachable",
        level: "bad",
        detail: error instanceof Error ? error.message : String(error),
        fix: "Start Docker Desktop, then: npm run db:up",
      });
    }
  }

  checks.push({
    label: "Email delivery",
    level: process.env.RESEND_API_KEY ? "ok" : "info",
    detail: process.env.RESEND_API_KEY
      ? "Resend — messages are actually delivered."
      : "Local — messages are written to ./tmp/mail as readable HTML. Fine for testing; a provider is needed before real players rely on reminders.",
  });

  checks.push({
    label: "NFL data",
    level: "ok",
    detail: "ESPN supplies schedule, scores and point spreads. No API key required.",
  });

  return checks;
}

async function leagueChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  try {
    const { db } = await import("@/db/client");
    const { adminExceptions, games, jobRuns, rebuys, weeks } = await import("@/db/schema");
    const { and, eq, isNull, desc } = await import("drizzle-orm");
    const { currentSeason, listEntries } = await import("@/lib/season");

    const season = await currentSeason();
    if (!season) {
      return [
        {
          label: "Season",
          level: "bad",
          detail: "No season exists yet.",
          fix: "npm run seed",
        },
      ];
    }

    const week = season.currentWeek ?? 1;

    checks.push({
      label: "Season",
      level: "ok",
      detail: `${season.name} — ${season.mode} mode, registration ${
        season.registrationOpen ? "open" : "closed"
      }, current week ${week}.`,
    });

    if (season.mode === "practice") {
      checks.push({
        label: "Practice mode",
        level: "info",
        detail:
          "Entries are free, there is no payment gate and no settlement. Nothing here involves money.",
      });
    }

    const [weekRow] = await db
      .select()
      .from(weeks)
      .where(and(eq(weeks.seasonId, season.id), eq(weeks.weekNumber, week)))
      .limit(1);

    const gameCount = weekRow
      ? (await db.select({ id: games.id }).from(games).where(eq(games.weekId, weekRow.id))).length
      : 0;

    checks.push({
      label: `Week ${week} schedule`,
      level: gameCount > 0 ? "ok" : "warn",
      detail: gameCount > 0 ? `${gameCount} games loaded.` : "No games loaded for this week.",
      fix: gameCount > 0 ? undefined : "Sync from commissioner tools",
      fixHref: gameCount > 0 ? undefined : "/admin",
    });

    // Unlocked lines are the quiet one: default picks refuse to run without
    // them, so this only surfaces at the deadline if nobody checks.
    checks.push({
      label: `Week ${week} league lines`,
      level: weekRow?.linesLockedAt ? "ok" : "warn",
      detail: weekRow?.linesLockedAt
        ? `Locked ${weekRow.linesLockedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`
        : "Not locked. Default picks cannot be assigned until they are — they rank by the league line and will not invent one.",
      fix: weekRow?.linesLockedAt ? undefined : "Lock league lines",
      fixHref: weekRow?.linesLockedAt ? undefined : "/admin",
    });

    checks.push({
      label: `Week ${week} deadline`,
      level: weekRow?.sundayDeadlineAt ? "ok" : "warn",
      detail: weekRow?.sundayDeadlineAt
        ? `${weekRow.sundayDeadlineAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`
        : "Not computed. Sync the week to derive it from the schedule.",
    });

    const entries = await listEntries(season.id);
    const awaiting = entries.filter((e) => e.amountOwedCents > 0);
    checks.push({
      label: "Entries awaiting payment",
      level: awaiting.length === 0 ? "ok" : "warn",
      detail:
        awaiting.length === 0
          ? "Everyone who signed up has paid."
          : `${awaiting.length} player(s) not in the pool yet: ${awaiting
              .map((e) => `${e.firstName} ${e.lastName}`)
              .join(", ")}.`,
      fix: awaiting.length === 0 ? undefined : "Confirm payments",
      fixHref: awaiting.length === 0 ? undefined : "/admin",
    });

    const pendingRebuys = await db
      .select({ id: rebuys.id })
      .from(rebuys)
      .where(eq(rebuys.status, "awaiting_payment"));
    checks.push({
      label: "Rebuys awaiting confirmation",
      level: pendingRebuys.length === 0 ? "ok" : "warn",
      detail:
        pendingRebuys.length === 0
          ? "None outstanding."
          : `${pendingRebuys.length} rebuy(s) paid but not yet confirmed — those players are still out until you confirm.`,
      fix: pendingRebuys.length === 0 ? undefined : "Confirm rebuys",
      fixHref: pendingRebuys.length === 0 ? undefined : "/admin",
    });

    const openExceptions = await db
      .select({ id: adminExceptions.id, message: adminExceptions.message })
      .from(adminExceptions)
      .where(isNull(adminExceptions.resolvedAt));
    checks.push({
      label: "Unresolved data exceptions",
      level: openExceptions.length === 0 ? "ok" : "bad",
      detail:
        openExceptions.length === 0
          ? "None. Nothing was skipped or guessed."
          : `${openExceptions.length} open: ${openExceptions.map((e) => e.message).slice(0, 3).join(" · ")}`,
    });

    checks.push({
      label: `Week ${week} results`,
      level: weekRow?.resultsProcessedAt ? "ok" : "info",
      detail: weekRow?.resultsProcessedAt
        ? `Processed ${weekRow.resultsProcessedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`
        : "Not processed yet. This is normal until every game is final.",
    });

    const [reminder] = await db
      .select({ runKey: jobRuns.runKey, completedAt: jobRuns.completedAt })
      .from(jobRuns)
      .where(eq(jobRuns.runKey, `reminder:${season.id}:week-${week}`))
      .limit(1);
    checks.push({
      label: `Week ${week} reminder email`,
      level: reminder ? "ok" : "info",
      detail: reminder ? "Already sent for this week." : "Not sent yet.",
      fix: reminder ? undefined : "Send weekly reminder",
      fixHref: reminder ? undefined : "/admin",
    });

    const [lastJob] = await db
      .select({ jobName: jobRuns.jobName, startedAt: jobRuns.startedAt })
      .from(jobRuns)
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);
    checks.push({
      label: "Last background job",
      level: "info",
      detail: lastJob
        ? `${lastJob.jobName} at ${lastJob.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`
        : "None run yet.",
    });
  } catch (error) {
    checks.push({
      label: "League health",
      level: "bad",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return checks;
}

function Section({ title, checks }: { title: string; checks: Check[] }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Status</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.label}>
              <th scope="row">{check.label}</th>
              <td>
                <span className={statusClass(check.level)}> {statusWord(check.level)}</span>
              </td>
              <td>
                {check.detail}
                {check.fix ? (
                  <div style={{ marginTop: "0.35rem" }}>
                    {check.fixHref ? (
                      <>
                        <Link href="/admin">{check.fix}</Link> in commissioner tools
                      </>
                    ) : (
                      <>
                        Run <code>{check.fix}</code>
                      </>
                    )}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function StatusPage() {
  const user = await currentUser();
  const environment = await environmentChecks();

  // League health exposes who has not paid, so it is commissioner-only.
  const league = user?.isAdmin ? await leagueChecks() : [];

  const problems = [...environment, ...league].filter((c) => c.level === "bad" || c.level === "warn");

  return (
    <>
      <h1>Status</h1>
      <p className="muted">
        {problems.length === 0
          ? "Everything is ready."
          : `${problems.length} item${problems.length === 1 ? "" : "s"} need attention.`}{" "}
        <Link href="/">Back to the app</Link>
      </p>

      <Section title="Environment" checks={environment} />

      {user?.isAdmin ? (
        <Section title="League health" checks={league} />
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            League health is visible to the commissioner only — it lists who has not paid.
          </p>
        </div>
      )}
    </>
  );
}
