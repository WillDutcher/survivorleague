/**
 * Local setup status.
 *
 * The first thing to load after cloning: it verifies the database is reachable,
 * migrations are applied, and mail is being captured, and tells you the exact
 * command to run for whatever is missing. Replaced by the player dashboard once
 * signup exists.
 */

export const dynamic = "force-dynamic";

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
        detail:
          tableCount > 0
            ? `${tableCount} tables present.`
            : "Database is reachable but empty.",
        fix: tableCount > 0 ? undefined : "npm run db:migrate",
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
    label: "Mail transport",
    ok: true,
    detail: process.env.RESEND_API_KEY
      ? "Resend — messages will actually be delivered."
      : "Local — messages are written to ./tmp/mail as readable HTML files.",
  });

  checks.push({
    label: "Odds provider",
    ok: true,
    detail: process.env.ODDS_API_KEY
      ? "The Odds API key present."
      : "No key set. Manual line entry works; automatic fetch is disabled.",
  });

  return checks;
}

export default async function Home() {
  const checks = await runChecks();
  const blocked = checks.filter((c) => !c.ok);

  return (
    <>
      <h1>Setup status</h1>
      <p className="muted">
        Local development environment for the Survivor League app.{" "}
        {blocked.length === 0
          ? "Everything is ready."
          : `${blocked.length} item${blocked.length === 1 ? "" : "s"} need attention.`}
      </p>

      <div className="card">
        <table>
          <caption className="muted" style={{ textAlign: "left", paddingBottom: "0.5rem" }}>
            Environment checks
          </caption>
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

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Rule engine</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          The league rules are implemented as pure functions under <code>src/rules/</code> with
          no database or framework dependency. Run <code>npm test</code> to verify all of them,
          including the tie-doubling rule, both rebuy tiers, no-reuse across rebuys, deterministic
          default picks, and settlement math.
        </p>
      </div>
    </>
  );
}
