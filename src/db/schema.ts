/**
 * Database schema.
 *
 * The league's hard invariants live here as Postgres constraints, not only as
 * application code. A bug in a route handler must not be able to let someone use
 * the Chiefs twice or get paid out of a pot that doesn't exist.
 *
 * Constraint highlights:
 *   - unique(entry_id, team_id)          no team reuse, ever, survives rebuys
 *   - unique(entry_id, week_id, slot)    multiple picks per week under the tie rule
 *   - unique(season_id, week_number)     one week row per NFL week
 *   - unique(job_runs.run_key)           idempotent scheduled jobs
 *
 * Money is always integer cents. Never floats.
 * Timestamps are always `timestamptz`. League-local display is a UI concern.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------- enums

export const seasonModeEnum = pgEnum("season_mode", ["practice", "live"]);
export const entryTierEnum = pgEnum("entry_tier", ["TWENTY", "EIGHTY"]);
export const entryStatusEnum = pgEnum("entry_status", [
  "registered",
  "paid",
  "active",
  "rebuy_pending",
  "eliminated",
  "winner",
  "settled",
]);
export const gameStatusEnum = pgEnum("game_status", [
  "scheduled",
  "in_progress",
  "final",
  "postponed",
  "canceled",
]);
export const pickSourceEnum = pgEnum("pick_source", ["player", "default", "commissioner"]);
export const pickOutcomeEnum = pgEnum("pick_outcome", ["win", "loss", "tie", "pending"]);
export const paymentCategoryEnum = pgEnum("payment_category", ["entry", "rebuy"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "verified", "refunded"]);
export const rebuyKindEnum = pgEnum("rebuy_kind", ["included", "paid"]);
export const rebuyStatusEnum = pgEnum("rebuy_status", [
  "offered",
  "awaiting_payment",
  "processed",
  "declined",
  "expired",
]);
export const splitResponseEnum = pgEnum("split_response", ["yes", "no", "no_response"]);
export const splitStatusEnum = pgEnum("split_status", [
  "open",
  "accepted",
  "rejected",
  "superseded",
]);

// ---------------------------------------------------------------- people

/**
 * Players are identified by full real name; email is the login identity (BRIEF).
 * DOB, state, and terms acceptance are captured at signup and never discarded (D7, D8).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phone: text("phone"),
    isAdmin: boolean("is_admin").notNull().default(false),

    // Age gate and legal record (D7, D8). 18+ enforced at signup.
    dateOfBirth: date("date_of_birth").notNull(),
    stateOfResidence: text("state_of_residence"),
    termsVersionAccepted: text("terms_version_accepted").notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    termsAcceptedIp: text("terms_accepted_ip"),

    /** The invite this account came from, giving the invite tree (D7). */
    invitedViaInviteId: uuid("invited_via_invite_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("users_email_unique").on(t.email)],
);

/**
 * Invite tokens (D7). Signup requires one. Confirmed players can generate links
 * to forward; unpaid registrants cannot, or the gate leaks.
 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull(),
    seasonId: uuid("season_id").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses").notNull().default(1),
    uses: integer("uses").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => [unique("invites_token_unique").on(t.token), index("invites_season_idx").on(t.seasonId)],
);

// ---------------------------------------------------------------- season structure

/**
 * One pool per season (D14) — there is deliberately no `leagues` table.
 * `rules` holds the SeasonConfig the engine executes and the rules page renders (D18a).
 */
export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    year: integer("year").notNull(),
    name: text("name").notNull(),
    mode: seasonModeEnum("mode").notNull().default("live"),
    registrationOpen: boolean("registration_open").notNull().default(false),
    currentWeek: integer("current_week"),
    /** Serialized SeasonConfig: prices, windows, deadlines, tie rule (D3, D18a, D20). */
    rules: jsonb("rules").notNull(),
    playerInvitesEnabled: boolean("player_invites_enabled").notNull().default(true),
    /**
     * Display team logos instead of colour chips (D31). Defaults to FALSE.
     * Colours carry no trademark exposure; logos are a deliberate opt-in the
     * commissioner can switch off in one click if the pool ever goes public.
     */
    showTeamLogos: boolean("show_team_logos").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("seasons_year_mode_unique").on(t.year, t.mode)],
);

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(), // canonical abbreviation, e.g. "PHI"
    providerId: text("provider_id"),
    city: text("city").notNull(),
    name: text("name").notNull(),
    conference: text("conference").notNull(),
    division: text("division").notNull(),
    /** Seeded from the provider rather than hardcoded. The always-safe display mode. */
    colorPrimary: text("color_primary").notNull(),
    colorSecondary: text("color_secondary").notNull(),
    /**
     * Provider-hosted logo URLs (D31). Hotlinked, never mirrored: serving a copy
     * ourselves would mean reproducing the artwork, which is a worse copyright
     * position than letting the provider's CDN serve its own image.
     * Only rendered when the season opts in; colors remain the default.
     */
    logoUrl: text("logo_url"),
    logoUrlDark: text("logo_url_dark"),
  },
);

export const weeks = pgTable(
  "weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id").notNull(),
    weekNumber: integer("week_number").notNull(),
    /**
     * The week begins at its earliest kickoff, derived from the schedule and never
     * hardcoded to Thursday (D19a). Also closes the previous week's split vote.
     */
    startsAt: timestamp("starts_at", { withTimezone: true }),
    /** Normal Sunday 12:55 PM ET deadline as an absolute instant. Commissioner-overridable. */
    sundayDeadlineAt: timestamp("sunday_deadline_at", { withTimezone: true }),
    linesLockedAt: timestamp("lines_locked_at", { withTimezone: true }),
    linesLockedByUserId: uuid("lines_locked_by_user_id"),
    resultsProcessedAt: timestamp("results_processed_at", { withTimezone: true }),
  },
  (t) => [unique("weeks_season_number_unique").on(t.seasonId, t.weekNumber)],
);

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekId: uuid("week_id").notNull(),
    providerGameId: text("provider_game_id").notNull(),
    awayTeamId: text("away_team_id").notNull(),
    homeTeamId: text("home_team_id").notNull(),
    kickoff: timestamp("kickoff", { withTimezone: true }).notNull(),
    status: gameStatusEnum("status").notNull().default("scheduled"),
    awayScore: integer("away_score"),
    homeScore: integer("home_score"),
    /** Set when the commissioner corrects provider data; paired with an audit event. */
    manuallyOverriddenAt: timestamp("manually_overridden_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (t) => [
    unique("games_provider_id_unique").on(t.providerGameId),
    index("games_week_idx").on(t.weekId),
  ],
);

/**
 * Odds snapshots (D10). Spreads are informational for players (D16) and rank
 * default picks (D18) — they never decide survival.
 *
 * `isLeagueLine` marks the commissioner-locked snapshot. League decisions join
 * only to league lines, so a later provider revision cannot retroactively change
 * a decision that was already made.
 */
export const oddsSnapshots = pgTable(
  "odds_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull(),
    provider: text("provider").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    favoriteTeamId: text("favorite_team_id"), // null = pick'em
    spread: text("spread"), // numeric as text to avoid float drift; parsed on read
    isLeagueLine: boolean("is_league_line").notNull().default(false),
    overriddenByUserId: uuid("overridden_by_user_id"),
    overrideReason: text("override_reason"),
  },
  (t) => [index("odds_game_idx").on(t.gameId)],
);

// ---------------------------------------------------------------- entries and picks

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    seasonId: uuid("season_id").notNull(),
    tier: entryTierEnum("tier").notNull(),
    status: entryStatusEnum("status").notNull().default("registered"),
    /** Picks required this week: 1 normally, 2 x ties after a tie week (D17). */
    requiredPicks: integer("required_picks").notNull().default(1),
    /** $80 tier only; expires after week 8 (D20). */
    includedRebuysRemaining: integer("included_rebuys_remaining").notNull().default(0),
    eliminatedAtWeek: integer("eliminated_at_week"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("entries_user_season_unique").on(t.userId, t.seasonId)],
);

/**
 * Picks.
 *
 * `unique(entry_id, team_id)` is the no-reuse rule, enforced by Postgres rather
 * than trusted to application code. It survives rebuys because nothing ever
 * deletes these rows.
 *
 * `unique(entry_id, week_id, slot)` allows the multiple picks a tie requires (D17).
 */
export const picks = pgTable(
  "picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").notNull(),
    weekId: uuid("week_id").notNull(),
    slot: integer("slot").notNull().default(1),
    teamId: text("team_id").notNull(),
    gameId: uuid("game_id").notNull(),
    source: pickSourceEnum("source").notNull().default("player"),
    /** Frozen at write time from the game's kickoff and the week's deadline. */
    lockAt: timestamp("lock_at", { withTimezone: true }).notNull(),
    outcome: pickOutcomeEnum("outcome").notNull().default("pending"),
    /** For default picks: candidates considered, rule version, selection reason (D18). */
    rationale: jsonb("rationale"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("picks_entry_team_unique").on(t.entryId, t.teamId),
    unique("picks_entry_week_slot_unique").on(t.entryId, t.weekId, t.slot),
    index("picks_week_idx").on(t.weekId),
  ],
);

// ---------------------------------------------------------------- money

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").notNull(),
    seasonId: uuid("season_id").notNull(),
    category: paymentCategoryEnum("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    /** PayPal/Venmo reference or free-text note (D6). */
    externalReference: text("external_reference"),
    verifiedByUserId: uuid("verified_by_user_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_entry_idx").on(t.entryId)],
);

export const rebuys = pgTable(
  "rebuys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").notNull(),
    lossWeekNumber: integer("loss_week_number").notNull(),
    kind: rebuyKindEnum("kind").notNull(),
    priceCents: integer("price_cents").notNull(),
    status: rebuyStatusEnum("status").notNull().default("offered"),
    paymentId: uuid("payment_id"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One rebuy per entry per losing week — a retry must never double-charge.
    unique("rebuys_entry_loss_week_unique").on(t.entryId, t.lossWeekNumber),
  ],
);

// ---------------------------------------------------------------- split votes

/**
 * A proposed division of the pot (D19b). Need not be equal.
 * Exactly one proposal is live per season at a time (D19c); replaced proposals
 * become `superseded` and are retained for audit, never deleted.
 */
export const splitProposals = pgTable(
  "split_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id").notNull(),
    afterWeekNumber: integer("after_week_number").notNull(),
    proposedByEntryId: uuid("proposed_by_entry_id").notNull(),
    /** Allocations as [{entryId, amountCents}]; must sum exactly to the pot. */
    allocations: jsonb("allocations").notNull(),
    potCentsAtProposal: integer("pot_cents_at_proposal").notNull(),
    note: text("note"),
    status: splitStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    /** First kickoff of the next week; silence counts as no from here (D19a). */
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("split_proposals_season_idx").on(t.seasonId)],
);

/**
 * Consent is bound to a proposal id. A ballot on a superseded proposal is stale
 * and counts as no response — a yes to one allocation is not a yes to another (D19b).
 */
export const splitBallots = pgTable(
  "split_ballots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    response: splitResponseEnum("response").notNull().default("no_response"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [unique("split_ballots_proposal_entry_unique").on(t.proposalId, t.entryId)],
);

/**
 * What each recipient is owed, and whether the commissioner has paid them yet.
 *
 * The app computes the amounts and holds the consent trail; it never moves money
 * (D22). Disbursement is manual, by the commissioner, exactly like collection.
 * These rows are a checklist and a record, not an instruction to any payment API.
 */
export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  /** "winner" | "split" | "week18_even" — how this payout was arrived at. */
  basis: text("basis").notNull(),
  proposalId: uuid("proposal_id"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  /** Ticked by the commissioner once the money has actually been sent. */
  paidOutAt: timestamp("paid_out_at", { withTimezone: true }),
  paidOutByUserId: uuid("paid_out_by_user_id"),
  paidOutReference: text("paid_out_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- operations

/**
 * Idempotency ledger for scheduled jobs. A job claims a run key before doing
 * work; a duplicate execution collides on the unique index and does nothing.
 * Duplicate runs must never create duplicate picks, charges, or eliminations.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runKey: text("run_key").notNull(), // e.g. "default-picks:2026:week-3"
    jobName: text("job_name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result"),
    error: text("error"),
  },
  (t) => [unique("job_runs_run_key_unique").on(t.runKey)],
);

/** Data problems that must be resolved by a human rather than guessed at. */
export const adminExceptions = pgTable(
  "admin_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id"),
    kind: text("kind").notNull(), // "missing_line" | "shortfall" | "sync_conflict" | ...
    severity: text("severity").notNull().default("warning"),
    message: text("message").notNull(),
    context: jsonb("context"),
    resolvedByUserId: uuid("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_exceptions_open_idx").on(t.resolvedAt)],
);

/** Every commissioner action, attributable and timestamped (BRIEF). */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId)],
);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  channel: text("channel").notNull().default("email"),
  status: text("status").notNull().default("queued"),
  payload: jsonb("payload"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- auth

/**
 * Server-side sessions.
 *
 * The cookie holds a random token; only its SHA-256 hash is stored here, so a
 * database leak does not hand anyone a working session. Sessions are revocable
 * (delete the row) and expire on their own.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
  },
  (t) => [
    unique("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/**
 * Login attempt log, used to throttle credential guessing.
 * Also a useful audit trail if someone claims they were locked out.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    succeeded: boolean("succeeded").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.attemptedAt)],
);

/**
 * Password reset tokens. Single-use, short-lived, hashed at rest for the same
 * reason sessions are. A reset flow is mandatory given email+password auth (D5):
 * without it every forgotten password becomes a Sunday-morning text to the
 * commissioner.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("password_resets_token_hash_unique").on(t.tokenHash)],
);

/**
 * Email verification tokens.
 *
 * Single-use, hashed at rest, same as sessions and password resets. The point is
 * not security theatre: every reminder and every payment nag goes to this
 * address, so an unverified typo means a player silently never hears from the
 * league and the commissioner cannot reach them.
 */
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("email_verifications_token_hash_unique").on(t.tokenHash)],
);

/**
 * Payment nag log.
 *
 * One row per entry per nag, so the escalating schedule can tell what has
 * already been sent and a retry never mails the same person twice for the same
 * step (D9 — the app does the nagging, not the commissioner).
 */
export const paymentReminders = pgTable(
  "payment_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").notNull(),
    /** Which step of the escalation this was: 1, 2, 3... */
    step: integer("step").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    delivered: boolean("delivered").notNull().default(true),
  },
  (t) => [unique("payment_reminders_entry_step_unique").on(t.entryId, t.step)],
);
