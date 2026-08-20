/**
 * Admin exceptions: deduplication and resolution.
 *
 * Dedup is the part that matters. Syncs run on a schedule and an unmatched game
 * stays unmatched every time, so without it the one new problem gets buried
 * under fifty copies of the old one and the resolve screen becomes useless.
 */
import { and, eq, like } from "drizzle-orm";
import { db } from "../src/db/client";
import { adminExceptions, auditEvents, seasons, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import {
  openExceptionCount,
  openExceptions,
  raiseException,
  resolveAllOfKind,
  resolveException,
  resolvedExceptions,
} from "../src/lib/exceptions";
import { SEASON_2026, type SeasonConfig } from "../src/rules/config";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const YEAR = 2019;

async function cleanup() {
  const all = await db.select().from(seasons).where(eq(seasons.year, YEAR));
  for (const s of all) {
    await db.delete(adminExceptions).where(eq(adminExceptions.seasonId, s.id));
    await db.delete(seasons).where(eq(seasons.id, s.id));
  }
  const probes = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "ex-%@example.test"));
  for (const p of probes) await db.delete(auditEvents).where(eq(auditEvents.actorUserId, p.id));
  await db.delete(users).where(like(users.email, "ex-%@example.test"));
}

async function main() {
  await cleanup();
  const config: SeasonConfig = { ...SEASON_2026, year: YEAR, mode: "live" };

  const [season] = await db
    .insert(seasons)
    .values({
      year: YEAR,
      name: "Exception probe",
      mode: "practice",
      registrationOpen: false,
      rules: config,
      currentWeek: 1,
    })
    .returning({ id: seasons.id });
  const seasonId = season!.id;

  const [admin] = await db
    .insert(users)
    .values({
      firstName: "Comm",
      lastName: "Probe",
      email: `ex-1-${Date.now()}@example.test`,
      passwordHash: await hashPassword("probe-password-1"),
      isAdmin: true,
      dateOfBirth: "1990-01-01",
      stateOfResidence: "VA",
      termsVersionAccepted: "test",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: users.id });

  const before = await openExceptionCount();

  console.log("\nDeduplication");
  const msg = "Could not match provider game 55123 to any team.";
  let r = await raiseException({ seasonId, kind: "sync_conflict", message: msg });
  check("the first sighting creates a row", r.created);

  r = await raiseException({ seasonId, kind: "sync_conflict", message: msg });
  check("the same problem again does NOT create a second", !r.created);

  await raiseException({ seasonId, kind: "sync_conflict", message: msg });
  let open = await openExceptions(seasonId);
  check("one row survives three syncs", open.length === 1, String(open.length));
  check("and it counts the repeats", open[0]!.seenCount === 3, String(open[0]!.seenCount));

  r = await raiseException({ seasonId, kind: "sync_conflict", message: "A different problem." });
  check("a genuinely different message does create a row", r.created);

  r = await raiseException({ seasonId, kind: "shortfall", severity: "error", message: msg });
  check("the same message under a different kind is separate", r.created);

  console.log("\nOrdering");
  open = await openExceptions(seasonId);
  check("three are open", open.length === 3, String(open.length));
  check("errors sort above warnings", open[0]!.severity === "error", open[0]!.severity);

  console.log("\nResolving one");
  const target = open.find((o) => o.kind === "shortfall")!;
  const res = await resolveException(target.id, admin!.id, "Added the missing team mapping");
  check("it resolves", res.ok, res.message);

  open = await openExceptions(seasonId);
  check("it leaves the open list", open.length === 2, String(open.length));

  const done = await resolvedExceptions(10);
  check("it appears in recently resolved", done.some((d) => d.id === target.id));
  check(
    "with the note kept",
    done.find((d) => d.id === target.id)?.resolutionNote === "Added the missing team mapping",
  );
  check("and the resolver named", Boolean(done.find((d) => d.id === target.id)?.resolvedBy));

  const again = await resolveException(target.id, admin!.id, "different note");
  check("re-resolving is a no-op, not an error", again.ok, again.message);
  const stillDone = await resolvedExceptions(10);
  check(
    "and the original note stands",
    stillDone.find((d) => d.id === target.id)?.resolutionNote === "Added the missing team mapping",
  );

  console.log("\nRecurrence after a fix");
  r = await raiseException({ seasonId, kind: "shortfall", severity: "error", message: msg });
  check("the same problem AFTER resolution raises a new row", r.created);
  check("because a fix that did not hold is new information", r.id !== target.id);

  console.log("\nBulk resolve");
  const bulk = await resolveAllOfKind("sync_conflict", admin!.id, "Re-synced the week", seasonId);
  check("every open row of a kind clears at once", bulk.ok, bulk.message);
  open = await openExceptions(seasonId);
  check("only the other kind remains", open.length === 1, String(open.length));
  check("and it is the shortfall", open[0]!.kind === "shortfall", open[0]!.kind);

  const empty = await resolveAllOfKind("sync_conflict", admin!.id, "again", seasonId);
  check("bulk-resolving nothing says so", !empty.ok, empty.message);

  console.log("\nAudit and counts");
  const audits = await db
    .select()
    .from(auditEvents)
    .where(
      and(eq(auditEvents.entityType, "admin_exception"), eq(auditEvents.actorUserId, admin!.id)),
    );
  check("resolutions are audited", audits.length === 2, `${audits.length} (1 single + 1 bulk)`);

  const after = await openExceptionCount();
  check("the open count reflects the one left", after === before + 1, `${before} -> ${after}`);

  await cleanup();
  console.log(failures === 0 ? "\nAll exception checks passed.\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
