# Survivor League — Decision Log

Running record of product/architecture decisions made with the commissioner.
Answers here override ambiguity in `PROJECT_BRIEF.md`. Newest decisions appended at the bottom.

---

## D1 — Target season
**Decision:** 2026 season, live. Kickoff ~Sept 10, 2026 (~3.5 weeks from 2026-08-18).
**Implication:** Hard external deadline. Ship the weekly loop first; defer anything the commissioner can do by hand for a week or two.

## D2 — Commissioner
**Decision:** Will Dutcher is the commissioner again. He builds it and runs it.
**Implication:** Admin UI optimized for speed/density over onboarding hand-holding. Single admin for now; audit log still records actor.

## D3 — Entry tiers
**Decision:** $20 / $80 per `PROJECT_BRIEF.md`. The $20/$50 seen in the 2019 workbook is an obsolete price.
- $20: paid rebuys only through Wk5 — $10 after a Wk1 loss, $30 after Wks2-5 losses.
- $80: 3 included rebuys, usable through Wk8, none purchasable.

## D4 — Hosting
**Decision:** Managed cloud, near-free tier.
**Implication:** Needs reliable scheduled jobs (Thursday reminder, Sunday 12:59 ET default-pick, result sync). Stack proposal pending.

## D5 — Onboarding & auth
**Decision:** Self-service. Player signs up with email + password, chooses $20 or $80, pays, and is then on the active roster.
**Implication:**
- Email + password auth, properly hashed, with self-serve reset (a reset flow is mandatory — otherwise every forgotten password becomes a Sunday-morning text to the commissioner).
- Entry state machine needs a pre-roster state: `registered -> paid -> active`. Unpaid accounts can log in and look around but hold no roster spot, no pot share, and cannot submit a counting pick.
- Admin needs a "waiting on payment" queue, replacing the 2019 workbook's Paid / Pay Confirmation Sent columns.

## D6 - Payments
**Decision:** Commissioner-verified. Players pay by their existing method (PayPal/Venmo/cash); the app does not process money.
**Implication:**
- Admin gets a "waiting on payment" queue; marking Paid flips the entry onto the active roster.
- Payment ledger carries the fields the brief already calls for (amount, category, status, external reference/note, verified_by, verified_at), which keeps a later Stripe/PayPal integration from needing a schema migration.
- No PCI/payment-handling surface in v1.

## D7 - Signup gating, age gate, invites
**Decision:** Invite-gated self-service signup, forwardable by existing confirmed players. Age gate plus recorded terms acceptance required.
**Implication:**
- Signup requires a valid invite token; no token, no account. No public/open registration page.
- Any *confirmed* (paid, active) player can generate an invite link to forward. Unpaid registrants cannot - that would leak the gate.
- Invite tokens: expiry, use cap, revocable, visible and killable from admin. Season-level switch to disable player-generated invites entirely.
- Store the invite tree: every account records which confirmed player's link it came from.
- Signup captures and permanently stores: date of birth (hard block under the age floor - a real DOB field, not a checkbox), accepted terms version, acceptance timestamp, acceptance IP.
- Terms are versioned so it is provable what each person agreed to and when.
- No separate approval queue for forwarded invites: the commissioner-verified payment step (D6) already gates roster entry, so a stranger with a forwarded link still cannot reach the roster.
- Legal posture to preserve deliberately: the commissioner takes no rake, the pool is private/invite-only and not publicly advertised, and settlement math must balance exactly. Not legal advice; state law varies.
- Terms text to be drafted as an editable starting point (age, no-rake, private pool, rules enforced as coded, commissioner discretion on exceptions, no warranty).

**Sub-decision still open:** age floor (18 vs 21) and whether to collect/act on state of residence.

## D8 - Age floor and state of residence
**Decision:** 18+ hard floor via DOB. State of residence recorded at signup.
**Implication:**
- Fantasy-sports industry norm is 18+; a few states set 19 or 21 (Massachusetts uses 21 for DFS). Sports betting is generally 21+, but that is a different category from a private no-rake pool.
- OPEN RESEARCH: whether Virginia's Fantasy Contests Act reaches a private pool where the organizer takes no rake. Commissioner and most players are VA-based. Offered; not yet run.
- State stored alongside the terms acceptance record, so a problem state can be identified later without re-contacting anyone.

## D9 - Payment is the player's responsibility, not the commissioner's
**Decision:** The app does the nagging. Money passes through the commissioner's personal PayPal but is pot-in-transit, never his.
**Implication:**
- Unpaid player's dashboard states plainly: not in the pool until the entry is paid - with amount, where to send it, and the consequence.
- Automated reminder emails to unpaid registrants on an escalating schedule as kickoff approaches. This replaces the 2019 workbook's `Pay Confirmation Sent` and `Reminder Email Sent?` columns.
- Pick screen is unreachable in a counting state until payment is confirmed, so the consequence is visible from day one.
- Payment screen should instruct players which PayPal transfer type to use (friends-and-family vs goods-and-services). Practical note: ~$2,000 through a personal PayPal can trigger a 1099-K depending on the current threshold and transfer type.
- Settlement math must balance exactly - the no-rake posture from D7 depends on it.

## D10 - League spread source
**Decision:** Auto-fetch lines from an odds provider; commissioner reviews and locks the league lines on Thursday. Per-game manual override always available.
**Implication:**
- The locked snapshot is authoritative forever, even if the real line later moves. All default-pick and win-and-cover decisions read the snapshot, never live data.
- Snapshot records provider, captured_at, favorite, spread, league-line designation, and override metadata (who/when/why), per the brief's audit requirement.
- Human gate means a missing or garbage provider line cannot silently eliminate anyone - it surfaces at Thursday lock time instead.
- Thursday lock pairs naturally with the historical Thursday reminder email containing games and spreads.
- If the provider returns no line or conflicting data for a game, raise an admin exception rather than inventing a number.
- Odds provider not yet chosen - part of the pending architecture proposal.

## D11 - Week 1 scope
**Decision:** All four game-loop pieces target Week 1: picks/locks/no-reuse, default-pick job, results/elimination, Thursday reminder email. Plus signup, invites, and the payment queue, which are mandatory by definition.
**Implication:**
- Build order is by blast radius, so if anything slips it is the least dangerous piece: rule engine -> picks/locks/no-reuse -> default-pick job -> results/elimination -> reminder email.
- Commissioner accepts manual fallback only as an emergency, not as a plan.

## D12 - Practice seasons and rule validation
**Decision:** Seasons carry a mode: practice vs live. Practice seasons have $0 entries, no payment gate, and no settlement.
**Implication:**
- Permanent feature, not a one-off: any future rule change can be dry-run without touching real money.
- Commissioner wanted preseason games as a live litmus test. Calendar reality: the final 2026 preseason weekend is ~Aug 20-22, days after this conversation, so a player-facing preseason test is not feasible.
- Rule validation instead runs against synthetic fixtures that can force the dangerous paths preseason cannot produce on demand: NFL tie, ATS push, postponed/suspended game, strongest legal favorite already used, equal-line tie-break. Real preseason and 2019 workbook data used for realism alongside.
- Human validation (50 people, phones, 12:50pm Sunday) is a separate need and still worth scheduling before money is at stake.

## D13 - Human dress rehearsal
**Decision:** Free, non-counting practice round on the real Week 1 slate with an artificial early deadline (e.g. Saturday), run under a practice-mode season. Signup opens ~Sept 1.
**Implication:**
- REAL DEADLINE IS ~SEPT 1, NOT SEPT 10. Signup, invites, payment queue, and a working pick screen must exist ~2 weeks from 2026-08-18. Week 1 kickoff is the second deadline.
- Players arrive at real Week 1 already registered, paid, and having seen the pick screen lock once.
- Rehearsal must exercise: pick submission, lock at deadline, a default pick assigned to someone who missed, and the resulting dashboard state.
- Practice round uses real Week 1 games but must not consume no-reuse history or affect the live season.

## D14 - One pool per season
**Decision:** A season has exactly one player pool. No multiple concurrent leagues.
**Implication:**
- The two side-by-side lists in the 2019 `Distro` sheet were interested/confirmed vs. no-interest/no-response - an invite-status distinction, not a second pool.
- No league entity separate from season. Picks, standings, and settlement all scope to season.
- The prospect list maps onto invite tokens: unused/unclaimed tokens give the commissioner a "invited but never signed up" view for free.

## D15 - Hosting and scheduling
**Decision:** Next.js + TypeScript on Vercel Pro ($20/mo). Postgres on Neon, Drizzle ORM, Better Auth, Resend for email, Vitest for tests. Schedule/scores from ESPN unofficial endpoints; spreads from The Odds API free Starter tier.
**Implication:**
- Vercel Pro gives native per-minute cron. Hobby caps at 2 jobs / once daily, which cannot run the Thursday lock, Sunday 12:59 defaults, and result polling.
- Also clears the Hobby tier's non-commercial-use question.
- Jobs remain idempotent and re-runnable regardless; scheduling is a UX concern, not a correctness one (locks are enforced by comparing now to stored lock_at, and default picks are deterministic from frozen Thursday inputs).
- Full rationale in `ARCHITECTURE.md`.

## D16 - Point spreads are informational only  [SUPERSEDES PROJECT_BRIEF.md AND CLAUDE.md]
**Decision:** Point spreads are a display aid for players. They are NOT a rule mechanic and never determine whether a participant survives.
**Removed from the product:**
- The post-tie "next pick must win and cover the locked spread" requirement - deleted entirely.
- The ATS push question (was the brief's one explicitly unresolved rule) - now moot.
- Spread evaluation inside result processing; `evaluateResult` no longer takes a line or a tie-requirement state.
- Brief test cases "subsequent win + cover succeeds" and "win without cover fails the special requirement".
- The `CLAUDE.md` non-negotiable bullet asserting win-and-cover.
**Retained:**
- Odds fetch, snapshot and Thursday lock (D10) still happen - players see who is favored on the pick screen and in the Thursday email.
- Snapshot auditability retained; cheap, and still wanted for the record.
**Opened by this change:**
- An NFL tie now has no defined consequence. See D17.
- The default-pick rule still reads spreads ("strongest available favorite"). Needs an explicit ruling on whether that is acceptable use. See D18.

## D17 - NFL tie creates a doubling win requirement
**Decision:** A tie is neither a win nor a loss. It creates a debt of extra required wins in the following week.

Let R = picks required this week. Resolve a week as:

| Outcome | Result |
|---|---|
| ANY pick loses | Loss. Rebuy eligibility applies; eliminated if none remain. Other picks' results are irrelevant. |
| No losses, T ties | Survives. Next week requires 2 x T picks. |
| No losses, no ties (all R win) | Survives. Next week requires 1 pick (normal). |

**Formula:** next_week_requirement = max(1, 2 x ties_this_week). Wins never offset or pay down a tie.

Commissioner's worked cases, all consistent with the formula:
- 1 pick ties -> 2 required next week
- 2 required, both win -> back to 1
- 2 required, win + loss -> loss
- 2 required, win + tie -> 2 required next week (the win does not reduce the debt)
- 2 required, tie + tie -> 4 required next week
- 2 required, tie + loss -> loss

**Implication:**
- SCHEMA: a week is N picks per entry, not one. `unique(entry_id, week_id)` is wrong; use `unique(entry_id, week_id, slot)`. Season-wide `unique(entry_id, team_id)` no-reuse is unchanged.
- All picks in a multi-pick week are subject to the ordinary no-reuse rule; teams used in that week are burned even if the entry loses.
- Each pick locks independently against its own game's lock time.
- The default-pick job must be able to assign N teams for one entry in one week.
- Player and admin UI must make "you need 2 winners this week" unmissable.

**Still open under this rule:**
- Tie in Week 18, where there is no following week (D17a).
- Does a rebuy after a loss reset the requirement to 1?
- What if an entry has fewer legal unused teams than the requirement?
- Confirm each pick locks independently rather than all picks locking at the earliest lock time.

## D17a - Tie in Week 18 is a loss
**Decision:** A tie in Week 18 counts as a loss. You do not advance to the playoffs on a tie.
**Implication:**
- The tie-doubling rule (D17) applies Weeks 1-17 only. Week 18 has no following week to collect the debt, so the debt cannot be paid and the entry is out.
- Season never extends into the playoffs. No playoff schedule or odds sync needed.
- Must be stated explicitly on the player-facing rules page.

## D18a - Player-facing rules page is generated from config
**Decision:** The rules page players read is rendered from the same configuration the rule engine executes.
**Implication:**
- Entry prices, rebuy windows and costs, deadline times, the tie-doubling rule, the Week 18 exception, and the split mechanism all render from live config values.
- Rules and enforced behavior cannot drift apart - the drift is what starts arguments.
- A rule change is a config change that updates both the engine and the published rules at once.

## D19 - Weekly pot-split vote
**Decision:** After every week, all remaining survivors are offered the option to split the pot. One "no" removes the option and play continues to the next week. Unanimous "yes" ends the season immediately; prize notification is emailed to the winners and to all identified admins.
**Implication:**
- This is a recurring weekly workflow, not a one-off negotiation - it replaces the brief's looser "early split requires unanimous consent".
- Majority is never sufficient. Unanimity among *remaining survivors* only.
- Each vote records: who was alive, each person's response, timestamp, whether unanimous, and the resulting amounts. Fully auditable per the brief.
- On unanimous yes: season stops, remaining pot splits evenly among survivors, notification emails go out.
- Supports multiple identified admins on the notification list, even though D2 has a single commissioner today.

**Still open under this rule:** vote window and what a non-response counts as (D19a).

## D19a - Split-vote window
**Decision:** Non-response counts as NO. The vote opens when the week's results are processed and closes at the kickoff of the first game of the next week. Non-voters get a reminder email at 48 hours.
**Implication:**
- Votes cast after the next week's first kickoff are moot - the next week has officially started.
- No one's share can be given away by inaction, and one unreachable person cannot stall the season.
- GENERAL PRINCIPLE: a week officially begins at the earliest kickoff on its schedule, derived from synced data - never hardcoded to Thursday. The 2026 season reportedly has a Wednesday game; international and holiday games shift this routinely.
- Reminder email at 48h is a scheduled job; like all jobs it must be idempotent (never double-send).

## D18 - Default picks may be ranked by spread
**Decision:** Yes. The default-pick rule keeps using the locked league spread to select the strongest available favorite from the entry's legal teams.
**Implication:**
- Consistent with D16: the spread never determines whether anyone survives. It only determines which team an absent player is assigned. Outcome remains plain win-or-lose.
- Fairest available basis - the absent player provably received the best team still legal for them.
- Brief's equal-line tie-break still applies: prefer home team, then earliest game, then deterministic window order (early Sunday, late Sunday, SNF, Monday).
- Default picks store full rationale: candidate lines considered, selected team, rule version, snapshot reference, processing timestamp.
- In a multi-pick week (D17), the default assigns the top N legal favorites by the same ranking.
- The Odds API remains a binding dependency for this one decision; a missing line raises an admin exception rather than being invented.

## D17d - Picks lock independently in a multi-pick week
**Decision:** Each pick locks at min(its game's kickoff - 5 minutes, Sunday 12:55 PM ET), independently of the entry's other picks that week.
**Implication:**
- No change from the brief's existing lock rule; it simply applies per pick.
- Verified this leaks no information advantage. If an early pick LOST, the entry is already out regardless of later picks. If it WON or TIED, the entry still needs every remaining pick to win. The optimal later choice is identical in all branches, so watching an early result cannot inform a later pick.

## D17c - Insufficient legal teams for the requirement
**Decision:** If an entry has fewer legal unused teams than its required pick count, the entry is eliminated and an admin exception is raised for commissioner review/override.
**Implication:**
- Effectively unreachable: 17 weeks of survival burns ~17 of 32 teams, and even a bye-heavy week has far more than 4 teams playing.
- Defined anyway so the rule engine has no undefined branch. Undefined behavior surfaces on the one Sunday it matters.

## D17b - Rebuy clears the tie debt
**Decision:** A rebuy resets the pick requirement to 1. Used-team history still carries over and never resets.
**Implication:**
- The tie debt belongs to the run that ended; paying to re-enter re-enters under normal rules.
- Only the tie requirement clears. The no-reuse team history survives the rebuy, per the standing league rule.
- `rebuyOptionsFor` and the re-entry transition must explicitly zero the requirement counter.

## D20 - Rebuy structure, exact
**Decision:** Eligibility keys off the week the LOSS occurred, not the week of re-entry.

**$80 tier**
- 3 included rebuys, usable for losses in Weeks 1-8.
- Unused rebuys EXPIRE. A clean sheet with all 3 unused plus a Week 9 loss = eliminated.
- No rebuys after Week 8 under any circumstance. None purchasable, ever.

**$20 tier**
- Unlimited rebuys, but only for losses in Weeks 1-5.
- Week 1 loss: $10. Exclusive to the $20 tier AND exclusive to Week 1.
- Weeks 2-5 loss: $30. No exceptions.
- Week 6+ loss: eliminated.

**Design intent:** the $30 price is deliberately punitive, to push players toward the $80 option.

**Implication:**
- A Week 5 loss buys back in for Week 6. A Week 6 loss ends the entry.
- Pot accounting: $10/$30 paid rebuys add to the pot. $80 included rebuys add nothing (already paid at entry).
- The UI must show a $20 player the $30-vs-$80 math at the moment they are deciding whether to rebuy - that is when it lands.
- All of the above lives in season config so prices and windows change without a code change (D3).

## D21 - Virginia legal research (RESEARCH, NOT LEGAL ADVICE)
**Researched 2026-08-18 against primary sources. No attorney consulted.**

**Findings:**
1. Virginia's Fantasy Contests Act (Ch. 51, 59.1-556 through 59.1-570) was REPEALED effective 2026-07-01 by Acts 2026 cc. 565/566 (HB145/SB129). Replacement regime targets commercial operators: $50k permit application, $50k problem-gambling fund payment, $25k renewal, 10% tax on contest revenue. Most online summaries still describe the repealed law.
2. That regime almost certainly does not reach this pool - it targets revenue-taking operators, and a survivor pool is likely not a "fantasy contest" (fantasy turns on individual-athlete statistical performance; this is a pool on game outcomes). NOT VERIFIED: exact repealed definition text was unretrievable (Justia 403; state site shows only the repeal notice). Strong inference, not quotation.
3. The statute that does reach it is 18.2-325: any bet or wager of money for a chance at a prize on an uncertain outcome. No skill carve-out (skill games explicitly included). No carve-out for a no-profit organizer. Under 18.2-326 it is a Class 3 misdemeanor and, for a pool, EACH PERSON is guilty, not only the organizer.
4. The only apparent exception, 18.2-334, requires the game be conducted in a private residence not commonly used for such games AND with no "operator" (one who conducts, finances, manages, supervises or directs). A hosted web app fits neither condition.

**Honest conclusion:** moving from spreadsheet to hosted web app does not improve the Virginia posture and arguably worsens it. The audit trail that makes the league defensible internally is also durable documentary evidence. Class 3 misdemeanor is fine-only; enforcement against private friend pools is practically nonexistent, but that is an observation, not a defense.

**What actually changes the analysis:**
- Free league via practice mode (D12) removes consideration entirely -> not a wager. Clean, and already built.
- App never touching money is weaker and guts the payment tracking the commissioner asked for.
- No-rake, invite-only, age gate, and terms are good practice but create no statutory exception. Do not mistake them for a shield.

**Decision:** Does not block the build. Free-vs-paid is a config flag (D12), decidable the week signup opens. Commissioner advised to spend an hour with a Virginia attorney before money is collected.

## D19b - Splits need not be equal
**Decision:** A split proposal may allocate the pot unequally. Survivors negotiate the terms; unanimous consent is still required.
**Real precedent:** three survivors, one wanted to keep playing. The two who wanted out paid him $20 each out of their equal shares to agree to stop.

**Implication:**
- A proposal is legal only if it covers EXACTLY the remaining survivors, once each, with no negative amounts, summing EXACTLY to the pot. Validated at proposal time and re-validated at settlement.
- A survivor may be allocated $0 if they consent; they must still appear in the proposal.
- Eliminated players can never receive a share.
- EDITING A PROPOSAL VOIDS ALL PRIOR CONSENTS. Ballots are bound to a proposal id; a ballot referencing a superseded proposal counts as no response. A yes to one allocation is not a yes to another - without this, someone consents to $706 and a later edit silently reassigns them $606.
- Equal split remains the default suggestion and the mandatory Week 18 fallback.
- Proposal note field carries the human terms ("Dave gets $20 each from Mike and Tim to stop") into the audit record and the notification email.

**Still open:** who may author a proposal (any survivor vs commissioner-entered), and whether more than one proposal can be live at once (D19c).

## D19c - Split proposal authorship
**Decision:** Any remaining survivor may author a split proposal. Exactly one proposal is live at a time; a new one replaces the previous and voids its consents.
**Implication:**
- Self-service - the commissioner is not in the middle of the negotiation.
- No competing simultaneous proposals, so nobody is ever voting on two allocations at once.
- Replacing a proposal is the same code path as editing it: new proposal id, all consents void (D19b).
- Proposal history is retained for audit; superseded proposals are never deleted.

## D22 - The app never moves money, in either direction
**Decision:** The commissioner collects entries and pays out winners personally. The application computes amounts and holds the record; it never initiates a transfer.
**Rationale (commissioner):** he would not trust automation with disbursement.
**Implication:**
- Extends D6 (commissioner-verified collection) to the payout side. No payment API is ever integrated, in or out.
- `payouts` rows are a checklist and an audit record: computed amount, basis, and `paid_out_at` / `paid_out_by` / `paid_out_reference` ticked by the commissioner once money is actually sent.
- Settlement math, split proposals, and consent tracking all remain - what the app provides is the auditable answer to "who is owed exactly what, and who agreed to it", not the transfer itself.
- Removes any PCI or money-transmission surface entirely.

## D23 - Local-first development
**Decision:** Build and test entirely locally. Move to hosted only when ready to deploy.
**Implication:**
- Local Postgres 17 via Docker on host port 5433 (avoids collision with any later native install). Same major version the managed host runs, so constraints behave identically in dev and production.
- Email in local dev writes HTML files to ./tmp/mail and prints the path. Setting RESEND_API_KEY switches to real delivery with no other change. This removes the Resend domain-verification wait from the critical path entirely.
- ESPN schedule/scores need no key and work locally immediately.
- Odds API key is optional locally; manual line entry works without it.
- NO external account is required to develop: Neon, Vercel, and Resend all move to deploy time.
- Home page is a setup-status check that names the exact command to fix whatever is missing.
- Verified working 2026-08-18: Postgres 17.11, 18 tables migrated, app boots, 96 tests green.

## D24 - Auth built on Node crypto, not an auth library
**Decision (made by Claude, delegated):** Email+password with server-side sessions, implemented directly on Node's built-in crypto rather than Better Auth.
**Rationale:** the schema already carried `passwordHash`; the surface is small and well understood; one fewer dependency in the auth path is one fewer thing to break or be compromised two weeks before kickoff. ARCHITECTURE.md originally proposed Better Auth - this supersedes it.
**Hazards explicitly handled** (hand-rolled auth is where people get hurt):
- scrypt with per-user random salt; passwords never reversible, never logged.
- `timingSafeEqual` for all secret comparisons, so response timing cannot leak a hash or token.
- Session cookie holds a 32-byte random token; only its SHA-256 hash is stored. A database leak yields no usable sessions.
- Cookies httpOnly, sameSite=lax, secure in production.
- Login throttled per email: 8 failures in 15 minutes locks further attempts.
- Failed logins return an identical message whether or not the address exists, so the endpoint cannot enumerate league membership.
**Reversible:** swapping to a library later touches only `src/lib/auth.ts`.

## D25 - First account becomes commissioner
**Decision (made by Claude, delegated):** The first user to sign up is granted admin. Every account after that is a normal player.
**Rationale:** solves bootstrap without a hardcoded password or a manual database edit. Admin is granted explicitly thereafter, so a shared bootstrap link cannot mint more commissioners.

## D26 - Seed script mints the bootstrap invite
**Decision (made by Claude, delegated):** `npm run seed` creates the season and prints a 25-use, 90-day signup URL. `npm run seed -- practice` seeds a practice season instead (D12).
**Rationale:** signup requires an invite, invites come from confirmed players, and at the start there are none. Safe to re-run; never duplicates a season and always mints a fresh way back in.

## D27 - Validation order protects invite uses
**Decision (made by Claude, delegated):** All validation - including the 18+ age gate - runs BEFORE the invite is consumed.
**Rationale:** a rejected signup must not burn a single-use invite. Verified: an under-18 attempt left uses at 0 and created no user.
**Also:** invite consumption is a single atomic UPDATE carrying `uses < max_uses` in its WHERE clause, so two people racing for the last use of a link cannot both succeed.

## D28 - Password policy is length-only
**Decision (made by Claude, delegated):** Minimum 10 characters, no character-class requirements.
**Rationale:** length beats symbol gymnastics for real security, and complexity rules are what make fifty casual players give up during the one week that matters.

## D29 - ESPN supplies odds too; The Odds API is dropped  [SUPERSEDES D10's provider choice and ARCHITECTURE.md]
**Decision:** Point spreads come from ESPN's scoreboard payload, the same request that returns the schedule. The Odds API is not used.
**Rationale (commissioner):** ESPN is not going anywhere, and the spread is already there.
**Verified against real 2026 Week 1 data:** all 16 games carry odds, with provider name (DraftKings), a `details` string ("SEA -3.5"), a signed `spread`, and explicit `favorite` booleans per side.
**Implication:**
- One provider, no API key, no quota, no cost. The last external account requirement for the weekly loop disappears.
- Schedule and odds arrive in ONE request per week.
- SIGN CONVENTION: ESPN's `spread` is signed from the HOME team's perspective - negative means home is favored. Deriving the favorite from that sign alone gets away favorites exactly backwards. The parser uses the explicit `favorite` booleans instead, and a test asserts the parsed favorite matches the `details` string for all 16 games.
- The workflow from D10 is unchanged: fetch Thursday, commissioner reviews, commissioner locks, snapshot is authoritative forever.
- Lines move and books differ. The commissioner saw HOU -1.5 on espn.com/nfl/odds while the API's DraftKings line read BUF -1.5 for the same game. This is precisely why the snapshot records provider and captured_at, and why the locked line - not the live one - governs every decision.
- Odds provider remains swappable: `parseLines` returns a provider-neutral shape.

## D30 - Payment destination
**Decision:** Entry and rebuy payments go to PayPal `Ramtrap@aol.com`, sent as friends and family.
**Implication:**
- Lives in `src/lib/league.ts` as the single source, not scattered through templates.
- The unpaid dashboard banner shows the address, the amount, the transfer type, and instructs the player to put their full name in the note so the commissioner can match it.
- Friends-and-family avoids goods-and-services fees and keeps the transfers out of business-income reporting (see D9's 1099-K note).

## D31 - Team logos are an opt-in flag; colours are the default
**Decision:** Both display modes exist. `seasons.show_team_logos` defaults to FALSE (colours); the commissioner can switch to logos in one click from admin.
**Rationale (commissioner):** wants it to look nice, but asked whether logos are legal.

**The legal picture (RESEARCH/JUDGEMENT, NOT LEGAL ADVICE):**
- TRADEMARK: team logos are registered marks. Using a mark to identify the actual thing it refers to is nominative fair use - the strongest argument available. Two of its three legs are easily satisfied here (no more of the mark than needed; nothing implying endorsement). The weak leg is the first: NFL teams ARE readily identifiable by name and colour, which is exactly why PROJECT_BRIEF said to avoid depending on logos.
- COPYRIGHT: covers the artwork itself. HOTLINK, NEVER MIRROR. Serving our own copy would be reproduction and distribution; hotlinking means the provider's CDN serves its own image and we never make a copy.
- PRACTICAL, non-legal: these URLs come from an unofficial ESPN API. Hotlinking is plausibly against their terms and can break without notice.
- RISK READ: for a private, invite-only, ~50-person, no-rake pool the realistic chance of anyone caring is very low - but it is not zero, and it scales directly with visibility. A public site is a different conversation.

**Implication:**
- Colours are the risk-free baseline and remain the default. Logos are a deliberate opt-in, reversible in one click without a rebuild.
- Logo URLs are stored on `teams`; the images are never downloaded.
- ACCESSIBILITY, enforced in both modes: the team is ALWAYS identified in text. The logo/chip is `aria-hidden` decoration and never the only way to tell teams apart, so screen-reader users, colour-blind users, and anyone whose images failed to load all get the same information.
- A failed image degrades to the colour chip rather than an empty box - the CDN is unofficial and may vanish.

---

## Open questions


- [ ] Commissioner to consult a Virginia attorney before collecting money (see D21). Not blocking.
- [ ] Verify Resend free-tier daily send cap before the first Thursday blast to ~50 players.
- [ ] NOTE: 2026 Week 1 opens WEDNESDAY Sept 9 (NE at SEA, 8:20pm ET), not Thursday Sept 10. Deadlines are one day tighter than previously assumed.
