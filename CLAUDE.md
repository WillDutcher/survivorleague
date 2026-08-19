# CLAUDE.md — Survivor League

## Mission

Build Survivor League from scratch as a reliable full-stack NFL survivor-pool web application.

Read `PROJECT_BRIEF.md` first. Treat it as the product source of truth.

## Fresh Start

This is a new implementation.

Do not preserve old code, architecture, schema, or framework choices simply because an older project existed.

## Core Goal

Replace spreadsheet/email/text administration with a web app that:

- enforces league rules
- tracks payments and rebuys
- syncs NFL schedule/results
- stores point spreads used by the league
- accepts and locks player picks
- prevents team reuse
- assigns deterministic default picks
- processes wins/losses/ties
- handles survivor/elimination state
- calculates settlement
- gives the commissioner an auditable admin interface

## Non-Negotiable Product Rules

- Players are identified by full first + last name.
- Email is the login identity.
- Normally one NFL team is selected per active entry per week.
- A team cannot be reused during the season.
- Rebuy does not reset used-team history.
- Future picks are allowed but cannot conflict.
- Normal Sunday deadline is 12:55 PM ET.
- Earlier-game picks lock 5 minutes before kickoff.
- Deadline enforcement is server-side.
- $20 option:
  - $20 initial
  - Week 1 rebuy $10
  - Weeks 2–5 rebuy $30
  - no rebuys after Week 5
- $80 option:
  - $80 initial
  - 3 included rebuys through Week 8
  - no purchased extras
  - no rebuys after Week 8
- Missed/invalid locked pick gets a deterministic default based on the strongest legal favorite by the league spread.
- An NFL tie keeps the participant alive, but the next pick must win and cover the league's locked spread.
- Last survivor wins.
- Early pot split requires unanimous consent of all remaining survivors.
- If multiple survivors remain after Week 18, split evenly.
- Commissioner changes/overrides must be audited.
- Server/database is authoritative.

## UX Direction

- Clean and simple
- Mobile-friendly
- Accessible
- Team colors may be used for matchup/pick controls
- Do not depend on NFL logos
- Final winners should look highlighted/brighter
- Final losers should look muted/darkened
- Do not communicate state using color alone

## Engineering Priorities

1. Correct league domain model
2. Deterministic rule engine
3. Server-side deadline enforcement
4. Timezone-safe timestamps
5. Stored odds snapshots for historical decisions
6. Idempotent scheduled jobs
7. Audited admin actions
8. Automated tests for league rules
9. Simple player UX
10. Admin UX that replaces spreadsheets

## Recommended Workflow

Before substantial coding:

1. Read the brief.
2. Propose architecture/stack.
3. Identify only genuinely unresolved product rules.
4. Design schema and state transitions.
5. Create a milestone plan.
6. Implement in vertical, testable slices.

Do not silently invent behavior for rules the brief marks unresolved.
