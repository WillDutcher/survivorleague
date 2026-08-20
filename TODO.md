# TODO

Actionable checklist. Narrative context lives in `NEXT_STEPS.md`; rulings live in
`DECISIONS.md`.

**W** = Will · **C** = Claude

Last revised 2026-08-19.

---

## Blocking — needed before real money is involved

All code blockers are done. What remains here is yours.

- [ ] **W** — Read and edit the terms text in `src/lib/terms.ts`. Bump `TERMS_VERSION`
      if the wording changes materially
- [ ] **W** — Change `REPLY_TO` to `commissioner@novasurvivorleague.com` so players
      never see the personal address
- [ ] **W** — Confirm the signup date, and whether the season opens live or as practice

## In flight — the preseason rehearsal

The rehearsal is live in production right now. `npm run preseason -- clear` ends it
and reactivates the live season.

- [ ] **W** — Sign in as yourself and as a test player; report anything confusing
- [ ] **C** — Let the games finish, run `process-results`, and confirm eliminations,
      rebuy offers, and the split vote all fire on real data
- [ ] **C** — Smoke-test the whole flow on the deployed instance before real signups

## Nice to have

- [ ] **C** — Season config editing in admin (prices, rebuy windows, deadlines)
      instead of a code edit
- [ ] **C** — Player-visible audit: "why did I get this default pick?"
- [ ] **C** — Commissioner ability to reopen or extend a deadline, audited
- [ ] **C** — Bulk invite generation for the initial roster
- [ ] **C** — Mobile polish pass on the pick screen — the real test is 12:50 on a
      Sunday, one-handed
- [ ] **C** — SMS reminders (the brief lists this as a later channel)
- [ ] **C** — Optional: Gmail "Send mail as" via Resend SMTP, so replies also go
      *out* as commissioner@

## Gaps carried deliberately

- **Schedule sync must run from a residential connection.** ESPN blocks data centres
  (D34, D35). Scores and lines come from The Odds API, which works server-side, so
  only the schedule is affected — and the schedule is known months ahead.
- Email verification never blocks a pick. It is a deliverability signal, not a gate.
- The app never moves money in either direction (D22). Collection and payout stay
  manual, by design.

---

## Done

- [x] Rule engine as pure functions — tie-doubling, both rebuy tiers, no-reuse, locks,
      default picks, settlement
- [x] Schema with league invariants as Postgres constraints
- [x] Invite-gated signup, age gate, versioned terms with IP capture
- [x] Email + password auth, change password, reset password
- [x] Commissioner payment queue; escalating payment reminders; email verification
- [x] Provider split — ESPN for schedule, The Odds API for scores and spreads
- [x] Thursday line locking with permanent snapshots
- [x] Pick screen: every legal team selectable, used teams disabled with reasons
- [x] Results processing verified against real completed 2025 games
- [x] Rebuy offers, acceptance, and commissioner confirmation
- [x] Negotiated (uneven) split votes with unanimity and silence-as-no
- [x] Standings — tier, rebuy position, teams used, and picks revealed at kickoff;
      admins see everything immediately
- [x] Admin exception resolution, with deduplication so repeats do not pile up
- [x] Payout checklist at `/admin/payouts` — settle, then tick people off as you send
- [x] Commissioner pick override — until grading, audited, no-reuse still enforced (D44)
- [x] Missing-pick flagging and a targeted "chase missing picks" reminder
- [x] Team colour/logo tags with per-team WCAG contrast
- [x] Weekly reminder email
- [x] Preseason mode, quarantined and correctly labelled; 15-player rehearsal seeder
- [x] Demo league seeder from real results
- [x] `/status` with environment and league health
- [x] Deployed: Vercel Pro, Neon Postgres, Resend, domain verified, 12 cron schedules
- [x] Job endpoints secured and fail closed
- [x] All 18 weeks loaded; provider sync reports 0 unmatched
- [x] 170 tests, plus five database verification scripts against disposable seasons
- [x] README, DECISIONS, ARCHITECTURE, NEXT_STEPS
