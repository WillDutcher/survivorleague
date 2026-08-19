# Survivor League — Project Brief

> **NOTE — this brief is no longer the sole source of truth.**
> `DECISIONS.md` records rulings made with the commissioner and **supersedes this document wherever they conflict.**
> Most significant so far: **D16 — point spreads are informational only.** The post-tie "win and cover"
> rule described later in this file has been removed. Read `DECISIONS.md` before implementing any rule.

## What This Project Is

Survivor League is a private NFL survivor / last-man-standing pool.

Each participant has an entry in a season and selects one NFL team each week. In the normal case, that team must win for the participant to survive. A team may not be used more than once by the same entry during the season.

The application should replace the manual process that historically relied on spreadsheets, email/text submissions, manual checking of reused teams, manual application of rebuys, manual point-spread checking, and manual survivor tracking.

The system should become the source of truth for:

- participants and entries
- entry type
- payments
- rebuys
- NFL schedule and kickoff times
- point spreads used by the league
- weekly picks
- previously used teams
- future/reserved picks
- automatic/default picks
- pick deadlines and locks
- game results
- tie consequences
- elimination status
- active survivors
- pot size and payout/split decisions
- commissioner overrides and audit history

This is a fresh implementation. Do not preserve old architecture or code merely because it existed before.

---

## End Goal

Build a polished, reliable full-stack web application that can administer the entire Survivor League with as little commissioner bookkeeping as possible.

A participant should be able to log in, immediately understand their status, see which teams remain available, make or change a legal pick, and know when that pick locks.

The commissioner should be able to run the league from an admin interface instead of maintaining a separate spreadsheet.

The app should automatically enforce rules wherever practical.

---

## League Identity

This is a private social NFL pool.

Entry money is pooled for the players rather than retained as house profit.

Build it as a private/invite-oriented league-management application, not as a public sportsbook.

Avoid depending on NFL/team logos unless licensing is explicitly addressed. Team names, abbreviations, colors, schedules, scores, and odds must be used in accordance with the chosen provider's terms.

---

## Participant Identity and Authentication

Participants are displayed by full real name:

- first name
- last name

Email is the login identity.

Do not invent public usernames.

### Roles

**Player**
- manages own legal picks
- views own entry/payment/rebuy status
- views league-visible survivor information

**Administrator / Commissioner**
- manages seasons
- manages participants and entries
- records/verifies payments
- manages rebuys
- reviews/overrides picks and statuses when needed
- manages data-sync exceptions
- controls league processing
- sees audit history

Authorization must be enforced server-side.

---

## Entry Options

### $20 Option

- Initial entry: $20
- Paid rebuys available only through Week 5
- Rebuy after a Week 1 loss: $10
- Rebuy after losses in Weeks 2–5: $30
- No paid rebuys after Week 5

### $80 Option

- Initial entry: $80
- Includes 3 rebuys
- Included rebuys may be used through Week 8
- Additional rebuys cannot be purchased
- No rebuys after Week 8

### Rebuy Principles

A rebuy keeps or re-enters the participant according to league rules, but does not erase team-use history.

A team used before a loss remains unavailable after the rebuy.

Track:

- entry option
- rebuy eligibility
- included rebuys remaining
- paid rebuy amount, if any
- week/loss that triggered rebuy
- payment/approval status
- resulting entry status

Do not silently grant rebuys.

---

## Payments

Payments are part of league eligibility and must be tracked.

Historically PayPal has been used, with payments identified for the Survivor pool.

Direct PayPal processing is not required for the first implementation. A commissioner-verifiable ledger is acceptable.

Track:

- participant
- season
- payment type
- amount
- date
- status
- related entry or rebuy
- optional external reference/note
- administrator who verified it

Unpaid or pending entries/rebuys should be obvious in the admin UI.

---

## Core Weekly Pick Rule

Each active entry normally selects one NFL team per week.

That team must win for the entry to survive, except when the special post-tie rule applies.

A participant cannot use the same NFL team more than once during the season.

This prohibition survives rebuys.

The backend must reject reused-team picks.

---

## Future Picks / Reservations

Participants may make picks for future weeks.

A future pick reserves that team for that participant.

The system must prevent incompatible selections, including using the same team in two different weeks.

When one pick changes, future-pick eligibility must be re-evaluated.

Clearly distinguish:

- current-week pick
- locked pick
- editable future pick
- unavailable because already used
- unavailable because reserved in another future week

The server is authoritative.

---

## Pick Deadlines and Locking

League rule times are Eastern Time.

Store timestamps in a timezone-safe format and display them in Eastern Time where appropriate.

### Standard Sunday Deadline

Normal Sunday submission deadline: **12:55 PM ET**

### Earlier Games

If selecting a team that plays before the normal Sunday deadline, the pick must be submitted at least **5 minutes before that game's kickoff**.

This covers Thursday, Saturday, international/early games, etc.

### Editing

A pick can be changed while still legal.

Once the selected team's lock time is reached, the pick is locked.

Deadline enforcement must occur on the backend.

### Default Processing

Historically, missed picks are resolved immediately before the main Sunday slate. Previously discussed target: approximately **12:59 PM ET Sunday**.

Implementation should make scheduler behavior deterministic and auditable.

---

## No-Reuse Enforcement

For each entry, maintain complete team-use history.

The UI should visibly indicate teams that are no longer eligible.

Validate against:

- prior completed picks
- picks that count as used under league rules
- current/future reservations

Rebuy does not reset this list.

Commissioner override must be possible and audited.

---

## Default / Automatic Pick Rule

If an active participant fails to submit a valid weekly pick by the applicable deadline, assign a default pick.

The same mechanism can resolve an invalid locked pick that can no longer be corrected.

### Selection Logic

Choose the **strongest available favorite by the league's point spread** from teams still legal for that entry.

"Strongest favorite" means the team favored by the greatest number of points.

Example:

- Team A: -9.5
- Team B: -7
- Team C: -3

Team A ranks first.

Skip teams already used or otherwise unavailable.

### Equal-Line Tie Break

If multiple eligible teams have the same strongest line, use a deterministic tie-break:

1. prefer the home team where applicable
2. prefer the earliest applicable game
3. preserve deterministic game-window ordering, historically:
   - early Sunday
   - late Sunday
   - Sunday Night Football
   - Monday

The exact implementation must always produce the same result from the same inputs.

### Audit

Automatic/default picks must be labeled and store:

- reason generated
- candidate line data
- selected team
- odds/spread snapshot
- processing time
- rule/version used

---

## Duplicate-Pick Handling

The app should prevent duplicate/reused picks at submission time.

If a manual/imported/external workflow somehow creates one:

- warn the participant when practical
- allow correction before lock
- after correction is no longer possible, apply the default-pick rule
- record what happened

---

## Point Spreads / Odds

Point spreads matter for:

1. default-pick selection
2. the special post-tie rule

Use a reliable pregame odds source.

Do not rely on a continuously changing live line without preserving which line the league actually used.

Store odds snapshots with:

- provider/source
- timestamp
- favorite
- spread
- designated league-line status
- override metadata if applicable

For every line-based decision, it must be possible to answer later:

- what spread was used?
- when was it captured?
- which provider supplied it?
- was it overridden?

If the provider has no line or conflicting data, flag an admin exception instead of inventing one.

---

## NFL Tie Rule

If the participant's selected NFL game ends in a tie:

- participant remains alive
- next week's selected team must **win the game and cover the applicable point spread**

The app must clearly show that the participant is under this special requirement.

The next result must evaluate:

1. straight-up game outcome
2. result against the league's locked spread

Once satisfied successfully, the participant returns to ordinary survivor rules.

### Explicit Unresolved Detail

The exact outcome of an against-the-spread **push** under this special rule should be represented explicitly in configuration or surfaced as a rule decision before being hard-coded.

Do not silently guess it.

---

## Game Result Processing

Sync NFL game status/results and process affected picks.

Support at least:

- scheduled
- in progress
- final
- postponed
- canceled/suspended/exception

Do not eliminate or advance participants based on uncertain or unofficial states.

### Ordinary Pick

- win -> survives
- loss -> loss event; evaluate rebuy eligibility
- tie -> survives and activates next-week win-and-cover requirement

### Tie-Requirement Pick

Evaluate both the final score and the locked spread.

The result/reason should be visible to player and commissioner.

---

## Elimination and Rebuy Flow

When a participant loses:

1. create a loss/result event
2. determine rebuy eligibility
3. if no rebuy is available, eliminate
4. if rebuy is available, show required rebuy state
5. do not reactivate a paid-rebuy entry until payment/approval requirements are satisfied
6. preserve used-team history
7. log every transition

Use explicit entry states such as concepts like:

- pending payment
- active
- rebuy eligible/pending
- eliminated
- winner
- settlement complete

Exact enum names are an implementation choice.

---

## Winning / Pot Splits

Default format is last survivor standing / winner-take-all.

### Normal Finish

When only one valid active survivor remains, that participant wins the pot.

### Early Split

Remaining participants may split the pot early only with **unanimous consent of all remaining players**.

Record:

- who was alive
- proposed split
- each person's consent
- whether unanimous
- final amounts/status

Do not accept a majority vote.

### After Week 18

If multiple players remain after Week 18, split the remaining pot evenly among those survivors.

Pot and payout calculations must be auditable.

---

## NFL Schedule / Score Integration

Use a reliable data source for:

- season/week
- NFL teams
- games
- kickoff timestamps
- home/away
- game status
- final scores
- optionally live status

Do not hard-code the NFL schedule.

Provider choice should consider:

- licensing/terms
- reliability
- rate limits
- cost
- corrections
- timezone accuracy

Store enough authoritative game data locally to keep league logic stable even if the provider is temporarily unavailable.

---

## Notifications / Reminders

Historically participants receive a Thursday reminder containing games/spreads.

Support a workflow such as:

- weekly pick reminder
- schedule/spread summary
- pick confirmation
- pick changed
- pick locked
- invalid/duplicate warning
- default pick assigned
- loss/rebuy required
- rebuy confirmed
- elimination
- tie-rule requirement
- commissioner announcement

Email is the obvious first channel.

SMS/text can be added later.

Notifications are not the source of truth; the database is.

---

## Player Dashboard

After login, show:

- participant name
- season
- active/eliminated status
- entry option ($20 or $80)
- payment status
- rebuy status/rebuys remaining
- current week
- current pick
- lock/deadline
- special tie requirement if active
- previously used teams
- future reserved teams/picks
- pool/survivor summary

---

## Weekly Pick Screen

Show NFL games in an easy-to-scan matchup layout.

Each matchup should expose:

- away team
- home team
- kickoff
- league spread
- game status when relevant

Selection controls must clearly communicate eligibility.

A previously used team must not look selectable.

Illegal selections should produce an immediate explanation.

After save, confirm:

- team
- week
- opponent
- kickoff
- lock time
- user-selected vs automatic
- applicable spread requirement if under the tie rule

---

## League / Standings View

Make it easy to understand who is alive.

Useful information:

- active survivors
- eliminated participants
- entry option
- rebuy information where league-visible
- weekly result history
- prior team usage
- current picks subject to fairness/visibility rules
- pool/pot summary

Do not expose another player's current unlocked pick if that creates a fairness issue.

Default to hiding current picks until they lock unless league rules explicitly choose otherwise.

---

## Visual / UI Preferences

The app should feel like an NFL pool without depending on logos.

### Team Selection

Use team colors to differentiate teams and matchup choices.

Do not require NFL logos.

### Results

Once final:

- winner -> brighter/highlighted
- loser -> muted/darkened/shadowed

Do not rely on color alone; include status text/iconography.

### Names

Use full first + last names, not usernames.

### General UX

Prioritize:

- simple
- obvious
- mobile-friendly
- accessible
- little commissioner explanation required

---

## Accessibility

Build accessibility in from the beginning.

At minimum:

- keyboard-operable controls
- visible focus states
- semantic elements
- screen-reader labels
- sufficient contrast
- status not conveyed only by color
- accessible validation/errors
- responsive/mobile layout

---

## Commissioner / Admin Requirements

The admin area should allow a season to be run without direct database edits.

### Season Management

- create/configure season
- open/close registration
- configure entry options and rules
- select active season
- view league health/status

### Participants / Entries

- create/invite participant
- edit details
- create entry
- assign entry option
- mark payment
- manage admin role
- view history

### Rebuys

- see losses
- see eligibility
- see cost/included rebuys remaining
- mark payment
- approve/process rebuy
- deny/expire invalid rebuy
- preserve audit history

### Picks

- view all picks
- see locked/editable/default state
- identify invalid/reused picks
- make commissioner correction/override
- never overwrite history invisibly

### Games / Odds

- inspect sync status
- retry sync
- manually correct data only when necessary
- record actor/reason for overrides

### Results

- inspect/preview outcomes
- process idempotently
- identify exceptions
- correct external-data errors without corrupting history

### Pot / Settlement

- entry/rebuy payment ledger
- current pot
- payout/split records
- unanimous split workflow
- final settlement

### Audit

Important commissioner actions must be timestamped and attributable to an administrator.

---

## Suggested Domain Model

Claude may refine the schema, but these concepts should exist explicitly.

### Users
- id
- first_name
- last_name
- email
- auth identity
- role/admin flag
- contact preferences

### Seasons
- year/name
- current week/state
- timezone
- registration state
- rule configuration

### Entries
- user
- season
- entry option
- status
- tie-rule state
- payment state
- settlement state

### NFL Teams
- internal/provider ID
- abbreviation
- city/name
- display colors
- optional conference/division

### Weeks
- season
- NFL week
- start/end
- deadline state

### Games
- season/week
- provider ID
- away/home team
- kickoff
- status
- scores
- final state

### Odds Snapshots
- game
- provider
- favorite
- spread
- captured_at
- league-line designation
- override metadata

### Picks
- entry
- week
- game/team
- source: participant/default/commissioner
- created/updated time
- locked time
- result
- tie-requirement evaluation
- line snapshot used where applicable

### Rebuys
- entry
- loss week
- rebuy type
- cost
- eligibility
- payment/status
- processed time

### Payments
- user/entry
- season
- category
- amount
- status
- external reference/note
- verified by/at

### Pot Splits / Payouts
- season
- type
- amount
- recipients
- consent state
- settled date

### Notifications
- user
- type
- channel
- delivery state
- reference/payload

### Audit Events
- actor
- action
- entity
- before/after or event data
- timestamp
- reason

---

## Data Integrity Rules

Important invariants belong on the server/database, not just in the UI.

Examples:

- email unique
- no illegal team reuse
- no invalid edit after lock
- no rebuy outside allowed weeks
- no more than 3 included $80 rebuys
- correct $20 rebuy pricing
- results processed idempotently
- explicit payment/rebuy state transitions
- commissioner overrides audited

Use database constraints and transactions where helpful.

---

## Background Jobs / Automation

Likely scheduled processes:

- NFL schedule synchronization
- odds synchronization
- league-line snapshot/lock
- Thursday reminder
- deadline warnings
- Sunday default-pick assignment
- result synchronization
- pick-result processing
- rebuy/elimination processing

Jobs must be safe to retry.

Duplicate executions must not create duplicate picks, charges, or elimination events.

---

## Reliability Principles

This app affects money and elimination, so deterministic behavior matters.

Prefer:

- server-side deadlines
- timezone-aware timestamps
- transactions
- idempotent jobs
- stored odds snapshots
- explicit state machines
- audit logs
- admin exception queues
- automated rule tests

Avoid:

- deriving historical decisions from today's API data
- silently changing a spread after a decision
- browser-only validation
- destructive overwrites
- hidden admin fixes

---

## Testing Requirements

At minimum automate tests for:

### Picks
- valid first-time team
- reused team rejected
- future reservation collision
- edit before lock
- edit at/after lock rejected
- early-game lock
- normal Sunday deadline

### Default Picks
- strongest legal favorite chosen
- already-used favorite skipped
- reserved team skipped where appropriate
- equal-line tie-break deterministic
- audit data stored

### Rebuys
- $20 Week 1 = $10
- $20 Weeks 2–5 = $30
- $20 Week 6 = no rebuy
- $80 first three qualifying losses through Week 8 use included rebuys
- fourth $80 loss = no included rebuy
- $80 loss after Week 8 = no rebuy
- team history survives rebuy

### Results
- win
- loss
- NFL tie
- tie activates next-week special requirement
- subsequent win + cover succeeds
- win without cover fails special requirement
- postponed/unfinal game does not process prematurely

### Settlement
- one survivor wins
- early split requires unanimity
- non-unanimous split rejected
- multiple Week 18 survivors split evenly

### Security
- player cannot edit another player's pick
- player cannot use admin functions
- commissioner override audited

---

## Decisions Claude Should Not Guess Silently

Known unresolved item:

- outcome of an against-the-spread **push** while fulfilling the post-tie win-and-cover rule

Implementation/product decisions still to choose:

- NFL data provider
- odds provider
- exact league-line snapshot/lock policy
- email/notification provider
- hosting/deployment platform
- commissioner-verified vs integrated payments

These are choices to make during implementation; they are not reasons to weaken the established league rules.

---

## Definition of Success

A complete season should be runnable without a parallel Excel workbook.

Desired workflow:

1. Commissioner creates/configures season.
2. Players join and choose $20 or $80 option.
3. Payments are tracked.
4. NFL schedule and league spreads populate.
5. Players make picks.
6. Reused/illegal picks are prevented.
7. Picks lock correctly.
8. Missed picks receive deterministic defaults.
9. Results synchronize.
10. Wins/losses/ties process automatically.
11. Rebuy eligibility/costs calculate correctly.
12. Used-team history remains intact after rebuys.
13. Active survivors are always obvious.
14. Tie consequences carry into the next week.
15. App determines winner or records a valid split.
16. Entire season remains auditable.

The commissioner should intervene only for true exceptions, not routine weekly bookkeeping.
