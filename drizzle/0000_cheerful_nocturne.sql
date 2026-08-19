CREATE TYPE "public"."entry_status" AS ENUM('registered', 'paid', 'active', 'rebuy_pending', 'eliminated', 'winner', 'settled');--> statement-breakpoint
CREATE TYPE "public"."entry_tier" AS ENUM('TWENTY', 'EIGHTY');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('scheduled', 'in_progress', 'final', 'postponed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."payment_category" AS ENUM('entry', 'rebuy');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'verified', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."pick_outcome" AS ENUM('win', 'loss', 'tie', 'pending');--> statement-breakpoint
CREATE TYPE "public"."pick_source" AS ENUM('player', 'default', 'commissioner');--> statement-breakpoint
CREATE TYPE "public"."rebuy_kind" AS ENUM('included', 'paid');--> statement-breakpoint
CREATE TYPE "public"."rebuy_status" AS ENUM('offered', 'awaiting_payment', 'processed', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."season_mode" AS ENUM('practice', 'live');--> statement-breakpoint
CREATE TYPE "public"."split_response" AS ENUM('yes', 'no', 'no_response');--> statement-breakpoint
CREATE TYPE "public"."split_status" AS ENUM('open', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TABLE "admin_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"tier" "entry_tier" NOT NULL,
	"status" "entry_status" DEFAULT 'registered' NOT NULL,
	"required_picks" integer DEFAULT 1 NOT NULL,
	"included_rebuys_remaining" integer DEFAULT 0 NOT NULL,
	"eliminated_at_week" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_user_season_unique" UNIQUE("user_id","season_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" uuid NOT NULL,
	"provider_game_id" text NOT NULL,
	"away_team_id" text NOT NULL,
	"home_team_id" text NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"status" "game_status" DEFAULT 'scheduled' NOT NULL,
	"away_score" integer,
	"home_score" integer,
	"manually_overridden_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	CONSTRAINT "games_provider_id_unique" UNIQUE("provider_game_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"season_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"note" text,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_key" text NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	CONSTRAINT "job_runs_run_key_unique" UNIQUE("run_key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odds_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"favorite_team_id" text,
	"spread" text,
	"is_league_line" boolean DEFAULT false NOT NULL,
	"overridden_by_user_id" uuid,
	"override_reason" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"category" "payment_category" NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"external_reference" text,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"basis" text NOT NULL,
	"proposal_id" uuid,
	"settled_at" timestamp with time zone,
	"paid_out_at" timestamp with time zone,
	"paid_out_by_user_id" uuid,
	"paid_out_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"slot" integer DEFAULT 1 NOT NULL,
	"team_id" text NOT NULL,
	"game_id" uuid NOT NULL,
	"source" "pick_source" DEFAULT 'player' NOT NULL,
	"lock_at" timestamp with time zone NOT NULL,
	"outcome" "pick_outcome" DEFAULT 'pending' NOT NULL,
	"rationale" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "picks_entry_team_unique" UNIQUE("entry_id","team_id"),
	CONSTRAINT "picks_entry_week_slot_unique" UNIQUE("entry_id","week_id","slot")
);
--> statement-breakpoint
CREATE TABLE "rebuys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"loss_week_number" integer NOT NULL,
	"kind" "rebuy_kind" NOT NULL,
	"price_cents" integer NOT NULL,
	"status" "rebuy_status" DEFAULT 'offered' NOT NULL,
	"payment_id" uuid,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rebuys_entry_loss_week_unique" UNIQUE("entry_id","loss_week_number")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"mode" "season_mode" DEFAULT 'live' NOT NULL,
	"registration_open" boolean DEFAULT false NOT NULL,
	"current_week" integer,
	"rules" jsonb NOT NULL,
	"player_invites_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_year_mode_unique" UNIQUE("year","mode")
);
--> statement-breakpoint
CREATE TABLE "split_ballots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"response" "split_response" DEFAULT 'no_response' NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "split_ballots_proposal_entry_unique" UNIQUE("proposal_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "split_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"after_week_number" integer NOT NULL,
	"proposed_by_entry_id" uuid NOT NULL,
	"allocations" jsonb NOT NULL,
	"pot_cents_at_proposal" integer NOT NULL,
	"note" text,
	"status" "split_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text,
	"city" text NOT NULL,
	"name" text NOT NULL,
	"conference" text NOT NULL,
	"division" text NOT NULL,
	"color_primary" text NOT NULL,
	"color_secondary" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"date_of_birth" date NOT NULL,
	"state_of_residence" text,
	"terms_version_accepted" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"terms_accepted_ip" text,
	"invited_via_invite_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"week_number" integer NOT NULL,
	"starts_at" timestamp with time zone,
	"sunday_deadline_at" timestamp with time zone,
	"lines_locked_at" timestamp with time zone,
	"lines_locked_by_user_id" uuid,
	"results_processed_at" timestamp with time zone,
	CONSTRAINT "weeks_season_number_unique" UNIQUE("season_id","week_number")
);
--> statement-breakpoint
CREATE INDEX "admin_exceptions_open_idx" ON "admin_exceptions" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "games_week_idx" ON "games" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "invites_season_idx" ON "invites" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "odds_game_idx" ON "odds_snapshots" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "payments_entry_idx" ON "payments" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "picks_week_idx" ON "picks" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "split_proposals_season_idx" ON "split_proposals" USING btree ("season_id");