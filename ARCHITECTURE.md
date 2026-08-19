# Survivor League — Architecture Proposal

Status: proposed, pending commissioner approval.
Decisions this builds on: see `DECISIONS.md` (D1–D14).

---

## The organizing principle

**The rule engine is a pure TypeScript module with no database, no network, and no framework imports.**

It is a set of functions over plain data:

```
legalTeamsFor(entry, usedTeams, reservations, games)      -> Team[]
validatePick(entry, pick, games, now)                     -> Ok | Rejection(reason)
defaultPickFor(entry, lockedLines, games, usedTeams)      -> Team + full rationale
evaluateResult(pick, finalScore, lockedLine, tieState)    -> Survives | Eliminated | TieCarry
rebuyOptionsFor(entry, lossWeek, seasonConfig)            -> RebuyOffer[]
settle(survivors, pot, week, consents)                    -> Payout[]
```

Everything else — Postgres, Next.js, cron, email — is I/O wrapped around that core.

This matters because it is precisely what the previous attempt got backwards. That build started with
Express controllers and route files; the `TODO` sheet shows it completed exactly two rules before stalling.
The rules are the product. They get built first, in isolation, against tests, where a tie or an ATS push
or an exhausted favorite list can be forced on demand instead of waited for.

Practical consequence: every test in the brief's testing section is a plain unit test with no fixtures,
no database, and no clock mocking beyond passing a different `now`.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript | One deployable. Server-side enforcement is the default, not an opt-in. Good mobile story, which matters — most picks arrive from a phone. |
| Database | Postgres (Neon free tier) | Real constraints and transactions, which the brief requires for the invariants. Neon's branching gives throwaway databases for the practice season. |
| Data access | Drizzle ORM | Thin, explicit SQL-shaped queries and straightforward migrations. Avoids hiding the constraints that enforce league rules. |
| Auth | Better Auth | Email+password, verification, reset, and sessions out of the box — exactly D5. Hand-rolling session auth three weeks from kickoff is not a good trade. |
| Email | Resend | Free tier covers weekly reminders for ~50 players. **Caveat:** free plan has a daily cap; a 50-player blast plus confirmations can approach it. Verify before the first Thursday send, or move to SES. |
| Scheduling | External trigger -> secured app endpoint | See below. |
| Tests | Vitest | Fast, no ceremony. Rule engine tests run in milliseconds with zero setup. |

---

## External data

### Schedule and scores — ESPN unofficial endpoints

Free, no key. `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` and related.

Unofficial and unsupported: no SLA, can change without notice. Mitigations, all already required by the brief:

- Persist games, kickoffs, statuses and scores locally; league logic never reads the provider live.
- Never advance or eliminate on a non-final status.
- Missing or contradictory data raises an admin exception; it never gets guessed.
- Admin can correct any game manually, with actor and reason recorded.

### Odds — The Odds API (Starter, free)

500 credits/month, all sports, all markets. Our consumption is roughly one fetch per week, so headroom is
enormous even if a single call costs many credits.

Flow per D10: fetch Thursday -> commissioner reviews -> commissioner locks -> snapshot is authoritative
forever. Per-game manual override available, recorded with actor, timestamp and reason.

---

## Scheduling, and why timing is not a correctness risk

Jobs needed:

| Job | When (ET) | Consequence if late |
|---|---|---|
| Fetch odds | Thu morning | None; commissioner locks manually anyway |
| Lock league lines | Thu, commissioner-triggered | None; it is a human action |
| Thursday reminder email | Thu evening | Cosmetic |
| Assign default picks | Sun 12:59 | Cosmetic — see below |
| Sync results | Sun afternoon -> Tue | Delays standings only |
| Process results | after finals | Delays standings only |

**Two properties make the schedule non-load-bearing:**

1. **Locks are enforced by data, not by jobs.** A pick is legal only if `now < game.lock_at`, checked on
   every write inside a transaction. No job has to fire for a deadline to hold. If the entire scheduler
   died, no illegal pick would be accepted.

2. **Default picks are deterministic from frozen inputs.** Inputs are the Thursday-locked line snapshot and
   the entry's used-team set — both fixed before 12:55. The default computed at 12:59 and the one computed
   hours later are identical. Timeliness is a transparency concern (players should see their default before
   kickoff), not a correctness one.

So: assignment runs on a schedule for good UX, and is also computed idempotently on demand if the trigger
was missed. Every job takes a run key and is safe to execute twice.

### Scheduling options

- **Vercel Hobby + free external trigger** (Cloudflare Worker cron, or similar) calling a secret-authenticated
  endpoint. $0. Hobby cron alone cannot do this: 2 jobs, once daily, per-hour expressions fail at deploy.
- **Vercel Pro**, $20/mo, native per-minute cron. One vendor, less glue.
- **Fly.io / Railway** container with real cron in-process.

Note: Vercel's Hobby tier is for non-commercial use. A no-rake private pool plausibly qualifies, but it is
the commissioner's call.

---

## Data model

Close to the brief's suggested model. Deltas worth calling out:

- **No `leagues` table.** One pool per season (D14). Everything scopes to `season`.
- **`seasons.mode`** = `practice` | `live` (D12). Practice seasons have $0 entries, no payment gate, no settlement.
- **`invites`** — token, created_by, expires_at, max_uses, uses, revoked_at (D7). Every user records the
  invite they came from, giving the invite tree and the "invited but never signed up" view for free.
- **`users`** carries `date_of_birth`, `state`, `terms_version_accepted`, `terms_accepted_at`, `terms_accepted_ip` (D7, D8).
- **`entries.status`** — `registered` -> `paid` -> `active` -> (`rebuy_pending` | `eliminated` | `winner` | `settled`) (D5).
- **`odds_snapshots`** with an explicit `is_league_line` flag; league decisions join only to league lines.
- **`picks.source`** = `player` | `default` | `commissioner`, and default picks store the full rationale blob:
  candidate lines considered, rule version, selection reason, processing timestamp.
- **`audit_events`** on every commissioner action, with before/after and reason.

Constraints pushed into the database, not just application code:

- unique (entry_id, team_id) across the season — the no-reuse rule, enforced by Postgres
- unique (entry_id, week_id) — one pick per entry per week
- unique email
- result processing keyed for idempotency

---

## Build order

Sequenced by blast radius, so anything that slips is the least dangerous thing.

**Phase 1 — rule engine + schema (days 1–3)**  ✅ RULE ENGINE COMPLETE — 85 tests green, typecheck clean
Pure functions and their tests: no-reuse, lock legality, default-pick selection with tie-breaks, tie rule
and win-and-cover, rebuy pricing and eligibility, settlement math. Schema and migrations alongside.
Exit: the brief's entire test list is green, with zero UI in existence.

**Phase 2 — identity and money-in (days 4–6)**
Invites, signup with DOB/state/terms capture, email+password with reset, entry selection, payment queue,
unpaid-player nagging. Exit: you can invite yourself, sign up, and be marked paid.

**Phase 3 — the weekly loop (days 7–10)**
Schedule sync, odds fetch and Thursday lock, pick screen with team colors and eligibility states, server-side
lock enforcement. Exit: a real pick can be made and locked against real Week 1 data.

**Phase 4 — automation and rehearsal (days 11–14)**
Default-pick job, result sync and processing, elimination and rebuy flow, Thursday reminder email, admin
screens. Deploy. Seed the practice season.

**~Sept 1: signup opens, practice round runs (D13).**
**~Sept 10: Week 1 kickoff, live.**

Rebuys and settlement land during Phase 4 or shortly after — neither can possibly be needed before
Week 1 results exist, which buys real slack in the riskiest week.

---

## Open items

- Scheduling/hosting choice (above).
- ATS **push** under the post-tie win-and-cover rule — the brief's one explicitly unresolved rule. Needed
  before Phase 1 result evaluation is finished. Will be surfaced as an explicit config value, never guessed.
- Whether to research Virginia's Fantasy Contests Act applicability to a private no-rake pool.
- Resend daily-send cap verification before the first Thursday blast.
