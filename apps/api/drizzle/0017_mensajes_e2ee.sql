ALTER TABLE "messages" ADD COLUMN "e2ee" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "franking" text;--> statement-breakpoint
ALTER TABLE "report_evidence" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;