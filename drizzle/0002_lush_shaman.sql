ALTER TABLE "seasons" ADD COLUMN "show_team_logos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "logo_url_dark" text;