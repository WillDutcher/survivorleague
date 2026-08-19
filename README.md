# Survivor League

A private NFL survivor pool, built to replace the spreadsheet.

## Documents, in reading order

1. `CLAUDE.md` — mission and non-negotiable rules
2. `PROJECT_BRIEF.md` — the original product brief
3. `DECISIONS.md` — **rulings made with the commissioner; supersedes the brief wherever they conflict**
4. `ARCHITECTURE.md` — stack, data model, build order

If a rule in the brief and a rule in `DECISIONS.md` disagree, `DECISIONS.md` wins.

## Running it locally

You need Docker Desktop running, and Node 22+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run db:up
```

```bash
npm run db:migrate
```

```bash
npm run dev
```

Then open http://localhost:3000. The home page is a setup check — it verifies the
database is reachable, migrations are applied, and tells you the exact command to run
for anything missing.

**Nothing external is required to develop locally.** No hosting account, no database
service, no email provider, no API keys:

- **Database** — Postgres 17 in Docker, on port 5433 so it cannot collide with anything else you install.
- **Email** — written to `./tmp/mail` as readable HTML files, with the path printed to the console. Set `RESEND_API_KEY` to switch to real delivery; nothing else changes.
- **NFL schedule and scores** — ESPN's public endpoints, no key needed.
- **Point spreads** — optional. Without `ODDS_API_KEY`, manual line entry still works.

## Seeing it work

The 2026 games have not been played, so a fresh install has nothing to grade and
no eliminations to show. To click through a realistic, fully-played league:

```bash
npm run demo
```

That builds a 2025 Demo League from **real completed results**, plays four weeks,
and leaves a deliberate spread of states: survivors, someone carrying a tie debt
(two winning picks required), outstanding rebuy offers, an elimination, and an
unpaid signup. It prints a sign-in for every player; they all share one password,
so you can see the app through each of their eyes.

Your own admin account remains the commissioner.

```bash
npm run demo:clear
```

Removes it and makes the real season active again.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Start the app on :3000 |
| `npm test` | Run the rule engine test suite |
| `npm run test:watch` | Tests, re-running on change |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:up` | Start the local Postgres container |
| `npm run db:down` | Stop it — data survives |
| `npm run db:nuke` | Stop it and delete all data |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the database in a GUI |
| `npm run demo` | Build a fully-played demo league from real 2025 results |
| `npm run demo:clear` | Remove the demo and restore the real season |

## How the code is organized

```
src/rules/     the league rule engine — pure functions, no DB, no framework
src/db/        schema and client
src/lib/       cross-cutting helpers (mail, etc.)
src/app/       Next.js app router
drizzle/       generated SQL migrations
```

`src/rules/` is the important part and has one hard constraint: **it may not import
anything outside itself.** No database, no network, no framework, and no clock reads —
every function takes `now` explicitly.

That is what makes each league rule testable without fixtures, mocks, or a running
application, and it is the discipline the previous attempt lacked. The rules are the
product; everything else is I/O around them.

## Deployment

Not yet deployed. Target is Vercel Pro (for per-minute cron) plus a managed Postgres.
See `ARCHITECTURE.md`. Local development is fully self-contained until then.
