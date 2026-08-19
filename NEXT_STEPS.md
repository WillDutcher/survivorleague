# Next Steps

Where this stands and what is needed to continue. Written 2026-08-19.

---

## What I need from you

### Decisions (nothing is blocked waiting on these, but they shape what comes next)

| # | Question | Why it matters | Deadline |
|---|---|---|---|
| 1 | **Read and edit the terms text** in `src/lib/terms.ts` | It is my draft, in your name, and players accept it at signup. You should agree with what it says. Bump `TERMS_VERSION` if you change it materially | Before signup opens |
| 2 | **Logos or colours?** Currently logos are ON | Colours carry no trademark exposure; logos are a judgement call you own (D31). One click either way in `/admin` | Before signup opens |
| 3 | **Virginia attorney, one hour** | See D21. My research says the pool's posture rests on you taking no rake and it staying private — but I am not a lawyer, and the Fantasy Contests Act was repealed and replaced in July 2026 | Before money is collected |
| 4 | **Run the preseason rehearsal, or skip it?** | Preseason Week 3 (ESPN API week 4) is Aug 27–29 — the last window before the real thing | ~Aug 26 |
| 5 | **When does signup open?** | Target was ~Sept 1. Week 1 kicks off **Wednesday Sept 9**, not Thursday Sept 10 | — |

### Accounts (only needed to deploy — everything runs locally without them)

| Service | For | Notes |
|---|---|---|
| **Resend** | Real email | **Start this first** — domain verification is the one unpredictable wait. Also verify the free tier's daily send cap; a 50-player blast plus confirmations may exceed it |
| **Neon** | Managed Postgres | Free tier is fine at this scale |
| **Vercel Pro** | Hosting + cron | $20/mo. The free tier caps cron at once per day, which cannot run the Sunday default-pick job |

Put values in `.env.local` — it is gitignored. Do not paste them into chat.

### Feedback only you can give

Click through the demo league (`npm run demo`) as several different players and
tell me what confused you. That is worth more than any test I can write.

---

## What is built and verified

Signup with invite gate, age gate and versioned terms · email + password auth
with change and reset · commissioner payment queue · escalating payment
reminders · email verification · schedule, scores and spreads from ESPN ·
Thursday line locking · pick screen with no-reuse enforced by Postgres · lock
times including per-game early locks · deterministic default picks · results
processing · the tie-doubling rule · both rebuy tiers · eliminations · rebuy
acceptance and confirmation · negotiated split votes · standings with pick
hiding until lock · weekly reminder emails · preseason mode · demo seeder.

125 unit tests, plus five database-level verification scripts run against
disposable seasons.

---

## What is NOT built

Ranked by how much it would hurt.

1. **Deployment.** Nothing is hosted. Needs the three accounts above, plus cron
   triggers pointed at the job endpoints.
2. **Commissioner pick override.** The brief calls for correcting a bad pick with
   an audit trail. Audit logging exists; the override UI does not. You would have
   to edit the database directly today.
3. **Admin exception resolution.** Sync problems are recorded and shown on
   `/status`, but there is no way to mark one resolved from the UI.
4. **Season config editing.** Prices, rebuy windows and deadlines live in config
   and drive both the engine and the rules page, but changing them means a code
   edit rather than an admin form.
5. **Scheduled jobs run manually.** Every weekly action works from `/admin`, but
   nothing fires on its own until cron is wired up at deploy.
6. **Settlement payout screen.** Payout amounts are computed and recorded with a
   `paid_out_at` field; there is no screen to tick them off as you pay people.

---

## Where to pick up

Read `DECISIONS.md` first — 32 decisions, and it supersedes `PROJECT_BRIEF.md`
wherever they conflict. Then `README.md` for how to run it.

The natural next task is **deployment**, since everything else is exercisable
locally and deployment is the only thing standing between this and real players.
If you would rather keep building first, item 2 above (commissioner pick
override) is the one most likely to be needed in a live week.

---

## Calendar

| Date | What |
|---|---|
| Aug 27–29 | Preseason Week 3 — last rehearsal window |
| ~Sept 1 | Signup opens (target) |
| **Wed Sept 9** | **2026 Week 1 kicks off** — NE at SEA, 8:20 PM ET |
| Sun Sept 13 | First real Sunday deadline, 12:55 PM ET |
