# Survivor League

A private NFL survivor pool, built to replace the spreadsheet.

Pick one team a week. That team has to win. You can never use the same team twice
all season. Last one standing takes the pot.

---

## Documents, in reading order

1. **`CLAUDE.md`** — mission and non-negotiable rules
2. **`PROJECT_BRIEF.md`** — the original product brief
3. **`DECISIONS.md`** — rulings made with the commissioner. **Supersedes the brief wherever they conflict.**
4. **`ARCHITECTURE.md`** — stack, data model, build order

Working documents: **`TODO.md`** (actionable checklist) and **`NEXT_STEPS.md`**
(handoff context, calendar, and what is honestly not built).

If the brief and `DECISIONS.md` disagree, `DECISIONS.md` wins. The most
significant example: the brief describes a post-tie "win and cover the spread"
rule that has been **removed** — see D16.

---

## Running it locally

You need **Docker Desktop running** and **Node 22+**. Nothing else — no hosting
account, no database service, no email provider, no API keys.

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

Open http://localhost:3000. If anything is missing, `/status` names the exact
command to fix it.

> **PowerShell note:** `&&` is not a valid separator in Windows PowerShell 5.1.
> Run the commands one per line, or use `npm run db:up; if ($?) { npm run dev }`.

### What runs without any external service

| Thing | How it works locally |
|---|---|
| **Database** | Postgres 17 in Docker on port **5433**, so it cannot collide with anything you install later |
| **Email** | Written to `./tmp/mail` as readable HTML, path printed to the console. Set `RESEND_API_KEY` to switch to real delivery — nothing else changes |
| **Schedule, scores, spreads** | ESPN's public endpoints. No API key at all |

---

## Seeing it actually work

A fresh install has nothing to look at: the 2026 games have not been played, so
there is nothing to grade and nobody to eliminate.

```bash
npm run demo
```

Builds a **2025 Demo League from real completed results**, plays four weeks, and
leaves a deliberate spread of states to click through:

- four survivors, one of them **carrying a tie debt** (needs two winning picks)
- an **outstanding $80 rebuy** (free, one click) and an **outstanding $20 rebuy** ($30, with payment details)
- one player **eliminated** after declining their rebuy
- one **unpaid signup** who sees the payment banner and whose picks will not count

Every demo account shares one password, printed when it runs, so you can sign in
as each player and see the app through their eyes. Your own admin account stays
the commissioner.

```bash
npm run demo:clear
```

Removes it and makes the real season active again.

---

## Running a preseason dress rehearsal

Preseason exhibition games can be used as a full rehearsal — real games, real
deadlines, real defaults, **no money**.

```bash
npm run preseason
```

This wipes and rebuilds the rehearsal, then creates fifteen test players across
both tiers with varying rebuys left, all picking the **same game** split down the
middle so the week cannot end with everyone surviving or everyone out. Real
accounts are enrolled automatically with an active entry, so the commissioner can
play too. `npm run preseason -- clear` removes it and reactivates the live season.

It creates a preseason season that is:

- **forced to practice mode** — exhibition games can never decide real money
- **labelled everywhere** — the pick screen and dashboard both carry a banner so
  nobody mistakes it for the real thing
- synced from `seasontype=1`, entirely separate from the real schedule

Everything else behaves exactly as it will in the regular season, which is the
point: it is the cheapest way to find out what confuses people.

### Preseason week numbers are not what they look like

ESPN's API numbers preseason weeks **one higher** than the NFL's own labels,
because API week 1 is the Hall of Fame game:

| ESPN API week | What the NFL calls it | 2026 dates |
|---|---|---|
| 1 | Hall of Fame Game (1 game) | Aug 6 |
| 2 | **Preseason Week 1** | Aug 13–15 |
| 3 | **Preseason Week 2** | Aug 20–23 |
| 4 | **Preseason Week 3** | Aug 27–29 |

So preseason is the Hall of Fame game plus **three** weeks, not four. The app
stores the API number and translates only at display time, so players see
"Preseason Week 2" for the same games NFL.com labels PRE WK 2. When syncing from
`/admin`, enter the **API** number from the left column.

> **Why preseason is guarded so heavily:** ESPN uses `seasontype=1` for preseason
> and `2` for the regular season, and espn.com/nfl/odds shows whichever is next.
> Syncing exhibition games into a real season would be silent and catastrophic,
> so preseason has to be chosen deliberately and is quarantined once chosen.

---

## The commissioner's weekly routine

All of this lives in **`/admin`**, and every step is safe to run twice — nothing
will double-charge a rebuy or eliminate anyone twice.

| When | Do this | Why |
|---|---|---|
| **Tuesday** | **Sync** the coming week | Pulls schedule, kickoff times, and candidate spreads |
| **Thursday** | **Lock league lines** | Freezes the spreads. The locked snapshot is what every later decision uses, even if the real line moves |
| **Thursday** | **Send weekly reminder** | Emails the slate, lines, and deadline. Refuses to send twice |
| **Sunday ~12:59 ET** | **Assign default picks** | Gives the strongest legal favourite to anyone who missed. Deterministic — running it late gives an identical answer |
| **Sunday night → Tuesday** | **Process results** | Grades picks, applies the tie rule, offers rebuys, eliminates. Leaves alone anyone whose games are not final |
| **Any time** | **Send payment reminders** | Escalating nags at 2, 6, 12 days. The app does the chasing, not you |
| **Before any deadline** | **Chase missing picks** (on `/standings`) | Emails only the players still short, with a link to the pick page. Safe to press repeatedly — it re-checks who is short each time |

**Check `/status` before each deadline.** It flags the quiet failures — lines not
locked (default picks will refuse to run), unresolved sync exceptions, entries
stuck awaiting payment, and rebuys paid but not yet confirmed.

---

## The rules, as enforced

The player-facing rules page at `/rules` is **generated from the same
configuration the engine executes**, so published rules and enforced behaviour
cannot drift apart. Change a price in config and the rules page changes with it.

**Ties** — a tie is neither a win nor a loss. Each tie must be made good with
**two winning picks** the following week. Wins never pay down the debt: owe two,
go win-plus-tie, and you owe two again. Any loss in a multi-pick week is a loss.
**A tie in the final week is a loss** — there is no week left to pay it.

**Deadlines** — Sunday 12:55 PM ET normally; a pick on an earlier game locks five
minutes before that kickoff. Enforced server-side by comparing the clock to a
stored lock time, so no scheduled job has to fire on time for a deadline to hold.

**No reuse** — enforced by a Postgres constraint, `unique(entry_id, team_id)`, not
just by application code. It survives rebuys because nothing ever deletes a pick.

**Rebuys** — keyed off the week the **loss** happened.

| Tier | Rule |
|---|---|
| **$20** | $10 after a Week 1 loss (Week 1 only), $30 for Weeks 2–5, unlimited within that window. A Week 6 loss ends you |
| **$80** | 3 included rebuys for losses through Week 8. **Unused rebuys expire** — clean sheet plus a Week 9 loss is elimination. Nothing purchasable, ever |

**Splits** — unanimous or nothing. One objection ends it; **not answering counts
as no**. Splits need not be equal — any allocation everyone agrees to is valid,
and replacing a proposal voids every prior consent.

**Spreads are informational.** They rank default picks and nothing else. They
never decide whether anyone survives.

---

## How the code is organised

```
src/rules/          the league rule engine — pure functions, no DB, no framework
src/db/             schema and client
src/integrations/   ESPN parsers, with captured payloads as fixtures
src/lib/            data access and workflows around the engine
src/app/            Next.js app router
scripts/            seed, demo, and verification scripts
drizzle/            generated SQL migrations
```

**`src/rules/` has one hard constraint: it may not import anything outside
itself.** No database, no network, no framework, and no clock reads — every
function takes `now` explicitly.

That is what makes each league rule testable without fixtures, mocks, or a
running application, and it is the discipline the previous attempt lacked. The
rules are the product; everything else is I/O around them.

---

## Testing

```bash
npm test
```

170 unit tests over the rule engine, the provider parsers, and the contrast
helpers. No database, no network, no mocks.

Beyond that, several scripts exercise the database paths against a **disposable
season**, so they never touch real data:

```bash
npx tsx --env-file=.env.local scripts/verify-results.ts
```

| Script | Checks |
|---|---|
| `verify-picks.ts` | Cross-week reuse rejected by the server, deadlines, replace/remove, multi-pick slots |
| `verify-results.ts` | Grading against **real completed 2025 games**, every rebuy window, tie handling, idempotency |
| `verify-endgame.ts` | Rebuy acceptance and confirmation, split proposals and voting, standings visibility, reminders |
| `verify-override.ts` | Commissioner pick overrides — mostly the refusals: graded weeks, no-reuse, missing reasons |
| `verify-payouts.ts` | Settlement for both endings, and that payouts sum back to the pot exactly |
| `verify-nags.ts` | Email verification tokens, escalating payment reminders |
| `verify-preseason.ts` | Preseason syncs exhibition games and never leaks a real one |

---

## Deployment

**Live on Vercel Pro + Neon Postgres + Resend**, with twelve cron schedules in
`vercel.json`. Vercel Pro is required because the free tier caps cron at once per
day. See `ARCHITECTURE.md`.

### What runs by itself, and the one thing that does not

Everything a player touches, and every scheduled job, runs on Vercel with no
machine of the commissioner's involved: picks, locks, default-pick assignment,
results processing, rebuy offers, split votes, and all email.

**The single exception is the schedule sync.** ESPN blocks requests from data
centres — Vercel and Cloudflare Workers both get a 403 (D34, D35) — so
`npm run sync:prod -- <week>` has to run from a normal residential connection.
This is deliberately survivable rather than fragile:

- The schedule is known months ahead, so every week can be loaded in one sitting.
- Scores and betting lines come from **The Odds API**, which works fine from the
  server, so grading and lines never wait on anyone's laptop.
- League logic never calls a provider live. A sync that has not run yet means a
  week is not loaded — it never means a wrong result.

The only recurring reason to re-sync is **flex scheduling**, which moves late-season
kickoffs. Re-syncing recomputes lock times for picks that have not locked yet, and
only ever moves a lock earlier; it never reopens a pick that is already locked.

Local development is fully self-contained: Docker Postgres and mail written to
disk, no external accounts needed.
