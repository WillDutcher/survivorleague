/**
 * Wipe every player and start the real season clean.
 *
 * This is the deliberate end of the rehearsal: everyone who signed up to test
 * is removed and has to register again for the live season. It exists because
 * `preseason -- clear` only removes the practice season — anyone who joined
 * through an invite would keep an account and a half-state, which is a worse
 * starting position than nothing.
 *
 * WHAT SURVIVES: the schedule, teams, games and captured odds. Those are
 * expensive to reload — the ESPN sync has to run from a residential connection
 * — and nothing about them is personal.
 *
 * WHAT GOES: every user, entry, pick, payment, rebuy, invite, notification,
 * split ballot, payout and audit event.
 *
 * Requires typing the confirmation phrase. A destructive script that runs on a
 * bare `npm run` is a script that eventually runs by accident.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql as raw } from "drizzle-orm";
import * as schema from "../src/db/schema";

const url = process.env.PRODUCTION_DATABASE_URL;
if (!url) {
  console.error("PRODUCTION_DATABASE_URL is not set in .env.local.");
  process.exit(1);
}

const CONFIRM = "WIPE EVERYONE";
const provided = process.argv.slice(2).join(" ").trim();

if (provided !== CONFIRM) {
  console.error(`
This deletes every player account and everything attached to them.

The schedule, teams, games and odds are kept — reloading those needs the ESPN
sync, which only runs from a home connection.

To go ahead, run it again with the confirmation phrase:

  npm run reset:league -- ${CONFIRM}
`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require" });
const db = drizzle(sql, { schema });

async function main() {
  const [before] = await db.execute(raw`select count(*)::int as n from users`);
  const userCount = (before as { n: number } | undefined)?.n ?? 0;

  console.log(`\nWiping ${userCount} account(s) and all league state.\n`);

  // Order matters: children before parents, since the schema does not cascade.
  const steps: Array<[string, ReturnType<typeof raw>]> = [
    ["split ballots", raw`delete from split_ballots`],
    ["split proposals", raw`delete from split_proposals`],
    ["payouts", raw`delete from payouts`],
    ["payment reminders", raw`delete from payment_reminders`],
    ["payments", raw`delete from payments`],
    ["rebuys", raw`delete from rebuys`],
    ["picks", raw`delete from picks`],
    ["notifications", raw`delete from notifications`],
    ["email verifications", raw`delete from email_verifications`],
    ["password resets", raw`delete from password_resets`],
    ["sessions", raw`delete from sessions`],
    ["invites", raw`delete from invites`],
    ["entries", raw`delete from entries`],
    ["audit events", raw`delete from audit_events`],
    ["admin exceptions", raw`delete from admin_exceptions`],
    ["job runs", raw`delete from job_runs`],
    ["users", raw`delete from users`],
  ];

  for (const [label, statement] of steps) {
    try {
      await db.execute(statement);
      console.log(`  cleared ${label}`);
    } catch (error) {
      // A table that does not exist in this schema version is not a failure —
      // report it and keep going rather than leaving the wipe half done.
      console.log(`  skipped ${label} (${(error as Error).message.split("\n")[0]})`);
    }
  }

  const [seasons] = await db.execute(
    raw`select count(*)::int as n from seasons where mode = 'practice'`,
  );
  const practiceCount = (seasons as { n: number } | undefined)?.n ?? 0;

  console.log(`
Done. Every account is gone and everyone registers fresh.

Still to do before real signups:
  1. Remove the practice season if one remains (${practiceCount} found):
       npm run preseason -- clear
  2. Confirm the live season is active and registrationOpen is true.
  3. Sign up yourself FIRST — the first account created becomes commissioner.
  4. Create an invite link from your dashboard and send it out.
`);

  await sql.end();
}

main();
