# TODO

Actionable checklist. Narrative context lives in `NEXT_STEPS.md`; rulings live in
`DECISIONS.md`.

**W** = Will · **C** = Claude

---

## Before signup opens (~Sept 1)

- [ ] **W** — Read and edit the terms text in `src/lib/terms.ts`. Bump `TERMS_VERSION` if changed materially
- [ ] **W** — Decide logos vs colours (currently logos). One click in `/admin`
- [ ] **W** — One hour with a Virginia attorney before collecting money (see D21)
- [ ] **W** — Confirm signup date, and whether the season opens live or as practice
- [ ] **W** — Create Resend account and start domain verification (**do this first** — unpredictable wait)
- [ ] **W** — Verify Resend's free-tier daily send cap covers ~50 players in one day
- [ ] **W** — Create Neon project, put connection string in `.env.local`
- [ ] **W** — Create Vercel account, upgrade to Pro (per-minute cron)
- [ ] **W** — Run `npm run demo`, sign in as several players, report what confused you
- [ ] **C** — Deploy to Vercel + Neon, verify migrations run against managed Postgres
- [ ] **C** — Wire cron triggers: odds fetch, Thursday reminder, Sunday 12:59 defaults, result sync
- [ ] **C** — Secure the job endpoints with `JOB_TRIGGER_SECRET`
- [ ] **C** — Verify a live ESPN sync works from the deployed app (blocked in my sandbox, works on Will's machine)
- [ ] **C** — Smoke-test the whole flow on the deployed instance before real signups

## Preseason rehearsal (window closes ~Aug 29)

- [ ] **W** — Decide whether to run it
- [ ] **C** — If yes: `npm run seed -- preseason`, sync ESPN API week 4 (= Preseason Week 3, Aug 27–29)
- [ ] **C** — Lock lines, take picks, process results, confirm every mechanic fires

## Needed in a live week (build before Week 1 if possible)

- [ ] **C** — **Commissioner pick override.** The brief requires correcting a bad pick with an audit trail. Audit logging exists; the UI does not. Today this needs a direct database edit
- [ ] **C** — **Admin exception resolution.** Sync problems are recorded and shown on `/status` but cannot be marked resolved from the UI
- [ ] **C** — **Payout checklist.** Amounts are computed and `paid_out_at` exists; no screen to tick people off as you pay them

## Nice to have

- [ ] **C** — Season config editing in admin (prices, rebuy windows, deadlines) instead of a code edit
- [ ] **C** — Player-visible audit/history: "why did I get this default pick?"
- [ ] **C** — Commissioner ability to reopen or extend a deadline, audited
- [ ] **C** — Bulk invite generation for the initial roster
- [ ] **C** — Mobile polish pass on the pick screen at 12:50 on a Sunday, one-handed
- [ ] **C** — SMS reminders (brief lists as a later channel)

## Known gaps I am carrying deliberately

- Scheduled jobs run manually from `/admin` until cron is wired at deploy. Every action is idempotent, so this is inconvenient rather than dangerous
- Email verification never blocks a pick — it is a deliverability signal, not a gate (see `src/lib/verification.ts`)
- The app never moves money in either direction (D22). Collection and payout stay manual, by design

---

## Done

- [x] Rule engine as pure functions — tie-doubling, both rebuy tiers, no-reuse, locks, default picks, settlement (125 tests)
- [x] Schema with league invariants as Postgres constraints
- [x] Local environment: Docker Postgres, mail to disk, no external accounts needed
- [x] Invite-gated signup, age gate, versioned terms with IP capture
- [x] Email + password auth, change password, reset password
- [x] Commissioner payment queue; escalating payment reminders; email verification
- [x] ESPN integration — schedule, scores and spreads from one keyless provider
- [x] Thursday line locking with permanent snapshots
- [x] Pick screen: every legal team selectable, used teams disabled with reasons
- [x] Results processing verified against real completed 2025 games
- [x] Rebuy offers, acceptance, and commissioner confirmation
- [x] Negotiated (uneven) split votes with unanimity and silence-as-no
- [x] Standings with picks hidden until they lock
- [x] Weekly reminder email
- [x] Preseason mode, quarantined and correctly labelled
- [x] Demo league seeder from real results
- [x] `/status` with environment and league health
- [x] README, DECISIONS, ARCHITECTURE, NEXT_STEPS
