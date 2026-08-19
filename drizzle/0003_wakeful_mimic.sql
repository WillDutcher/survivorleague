CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verifications_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "payment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered" boolean DEFAULT true NOT NULL,
	CONSTRAINT "payment_reminders_entry_step_unique" UNIQUE("entry_id","step")
);
