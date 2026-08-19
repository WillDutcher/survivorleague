import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Environment diagnostics.
 *
 * Development aid, not part of the player experience. Verifies the database is
 * reachable and migrated and names the exact command to fix whatever is missing.
 */

interface Check {
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  const url = process.env.DATABASE_URL;
  checks.push({
    label: "DATABASE_URL is set",
    ok: Boolean(url),
    detail: url ? "Found in environment." : "Not set.",
    fix: url ? undefined : "cp .env.example .env.local",
  });

  if (url) {
    try {
      const { sql } = await import("@/db/client");
      const [row] = await sql<{ version: string }[]>`select version() as version`;
      checks.push({
        label: "Database reachable",
        ok: true,
        detail: row?.version?.split(",")[0] ?? "Connected.",
      });

      const tables = await sql<{ count: number }[]>`
        select count(*)::int as count
        from information_schema.tables
        where table_schema = 'public'
      `;
      const tableCount = tables[0]?.count ?? 0;
      checks.push({
        label: "Migrations applied",
        ok: tableCount > 0,
        detail: tableCount > 0 ? `${tableCount} tables present.` : "Database is reachable but empty.",
        fix: tableCount > 0 ? undefined : "npm run db:migrate",
      });

      const seeded = await sql<{ seasons: number; teams: number; games: number }[]>`
        select
          (select count(*)::int from seasons) as seasons,
          (select count(*)::int from teams)   as teams,
          (select count(*)::int from games)   as games
      `;
      const counts = seeded[0];
      checks.push({
        label: "Season seeded",
        ok: (counts?.seasons ?? 0) > 0,
        detail: (counts?.seasons ?? 0) > 0 ? "A season exists." : "No season yet.",
        fix: (counts?.seasons ?? 0) > 0 ? undefined : "npm run seed",
      });
      checks.push({
        label: "Schedule loaded",
        ok: (counts?.games ?? 0) > 0,
        detail:
          (counts?.games ?? 0) > 0
            ? `${counts?.teams} teams, ${counts?.games} games.`
            : "No games loaded.",
        fix: (counts?.games ?? 0) > 0 ? undefined : "Sync from commissioner tools",
      });
    } catch (error) {
      checks.push({
        label: "Database reachable",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        fix: "Start Docker Desktop, then: npm run db:up",
      });
    }
  }

  checks.push({
    label: "Email",
    ok: true,
    detail: process.env.RESEND_API_KEY
      ? "Resend — messages will actually be delivered."
      : "Local — messages are written to ./tmp/mail as readable HTML files.",
  });

  // Schedule, scores AND spreads all come from ESPN now (D29) — there is no key
  // to configure and no odds vendor in the stack.
  checks.push({
    label: "NFL data",
    ok: true,
    detail: "ESPN — schedule, scores and point spreads. No API key required.",
  });

  return checks;
}

export default async function SetupPage() {
  const checks = await runChecks();
  const blocked = checks.filter((c) => !c.ok);

  return (
    <>
      <h1>Setup status</h1>
      <p className="muted">
        {blocked.length === 0
          ? "Everything is ready."
          : `${blocked.length} item${blocked.length === 1 ? "" : "s"} need attention.`}{" "}
        <Link href="/">Back to the app</Link>
      </p>

      <div className="card">
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
                  <span className={check.ok ? "status-ok" : "status-bad"}>
                    {" "}
                    {check.ok ? "OK" : "Needs attention"}
                  </span>
                </td>
                <td>
                  {check.detail}
                  {check.fix ? (
                    <div style={{ marginTop: "0.35rem" }}>
                      Run <code>{check.fix}</code>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
