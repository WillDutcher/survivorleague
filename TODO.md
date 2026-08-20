# TODO

Actionable checklist. Narrative context lives in `NEXT_STEPS.md`; rulings live in
`DECISIONS.md`.

**W** = Will · **C** = Claude

---

## Before signup opens (~Sept 1)

- [ ] **W** — Read and edit the terms text in `src/lib/terms.ts`. Bump `TERMS_VERSION` if changed materially
- [ ] **W** — Confirm signup date, and whether the season opens live or as practice
### Item 1 — email that actually reaches players ✅ DONE

Domain `novasurvivorleague.com` registered at Cloudflare, verified in Resend in
16 minutes. Real send confirmed: **inbox, not spam**, with SPF, DKIM and DMARC
all PASS and a double DKIM signature. Cloudflare Email Routing forwards
`commissioner@novasurvivorleague.com` to the commissioner's Gmail, running
alongside Resend's sending records without conflict — Cloudflare owns the root,
Resend owns the `send.` subdomain.

<details><summary>Original steps</summary>

Until a domain is verified, Resend is sandboxed: it can only send from
`onboarding@resend.dev`, and only to the address you signed up with. Fifty
players would receive nothing. This is the blocker, not polish.

- [x] **W** — Buy a domain (~$12/yr). Suggested registrar: **Cloudflare** — at-cost pricing, free DNS, fast propagation. Namecheap is fine too
      - Avoid "NFL" in the name — a domain implying affiliation is a real trademark problem
      - Candidates that looked unregistered: `thesurvivorleague.com`, `survivorpool.app`, `survivor.football`, `dutchersurvivor.com`
- [x] **W** — Create a free Resend account
- [x] **W** — In Resend, add the domain. It gives you 2–3 DNS records (SPF, DKIM, DMARC)
- [x] **W** — Paste those records into the domain's DNS. On Cloudflare this verifies in minutes
- [x] **W** — Create a Resend API key
- [x] **W** — Put in `.env.local`: `RESEND_API_KEY=...` and `MAIL_FROM="Survivor League <league@yourdomain>"`
- [x] **C** — Confirm real delivery end to end once the key is in

**Answered:** free tier is 3,000 emails/month, **100/day**, 1 domain. Fine for ~50
players, but a signup blast plus reminders plus confirmations on one day could
brush the daily cap.

</details>

- [ ] **W** — Once forwarding is confirmed, change `REPLY_TO` to `commissioner@novasurvivorleague.com` so players never see the personal address
- [ ] **C** — Optional later: Gmail "Send mail as" via Resend SMTP, so replies also go *out* as commissioner@
- [x] **W** — Neon project created (US East 1, PG 17.11 to match local) and `PRODUCTION_DATABASE_URL` set
- [x] **C** — Migrations applied to Neon; 23 tables and the key constraints verified present, database empty
- [ ] **W** — Create Vercel account, upgrade to Pro (per-minute cron)
- [ ] **W** — Run `npm run demo`, sign in as several players, report what confused you
- [ ] **C** — Deploy to Vercel + Neon, verify migrations run against managed Postgres
- [ ] **C** — Wire cron triggers: odds fetch, Thursday reminder, Sunday 12:59 defaults, result sync
- [ ] **C** — Secure the job endpoints with `JOB_TRIGGER_SECRET`
- [x] **C** — ESPN sync from the server: NOT POSSIBLE. ESPN blocks Vercel and Cloudflare Workers alike (D34, D35)
- [x] **C** — Scores and lines from the server via The Odds API: WORKING, verified live on the deployed app
- [ ] **W** — Load remaining weeks: `npm run sync:prod -- 2`, `3`, … so provider games have something to match
- [ ] **C** — Smoke-test the whole flow on the deployed instance before real signups

## Decided, no action needed

- [x] **Logos vs colours** — keep the admin toggle; switch whenever you like
- [x] **Legal consult** — declined. No rake, no profit, money only ever goes to winners (D33)

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
